/**
 * 技师评分科学化引擎 · 贝叶斯加权 + 时间衰减 + 真实样本量
 *
 * 解决朴素滑窗均值的两大病:①小样本偏差("1 条满分新技师排在多条高分老技师前")
 * ②无时效("半年前评价与昨天等权")。
 *
 * 标度:reviews.score_service 为 0-100;技师侧聚合列(scoreService/rating/ratingBayes)为 0-1000。
 *       本引擎读 reviews(0-100)→ ×10 → 0-1000 存技师侧,全端展示 /100 = 0-10。
 *
 * 种子兜底:0 条真实评价的技师(上线前演示账号)不清零,ratingBayes 回退现有 scoreService 种子值,
 *          排序不退化;真实评价进来后自动切换为贝叶斯值。
 */
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { reviews, therapists } from '@loverush/db';

export interface RatingContext {
  db: Database;
}

// 贝叶斯先验权重(相当于"C 条全站均值评价垫底")· 越大对小样本越保守
const PRIOR_WEIGHT = 8;
// 时间衰减半衰期(天)· 评价每过 H 天权重减半
const DECAY_HALFLIFE_DAYS = 180;
// 全站均值兜底(0-1000)· 连种子都没有时的极端兜底
const FALLBACK_PRIOR_1000 = 850;

let _meanCache: { value: number; expiresAt: number } | null = null;

/**
 * 全站服务分均值(0-1000)· 作贝叶斯先验。
 * 有真实评价 → AVG(reviews.score_service)×10;否则回退种子技师 AVG(scoreService);再否则常量。
 * 60s 内存缓存(对齐 fx.ts 范式)· 避免每次重算全表扫描。
 */
export async function globalServiceMean1000(ctx: RatingContext, now = Date.now()): Promise<number> {
  if (_meanCache && _meanCache.expiresAt > now) return _meanCache.value;

  const r = (await ctx.db.execute(
    sql`SELECT AVG(score_service)::float AS m FROM reviews WHERE is_hidden = 0`,
  )) as unknown as Array<{ m: number | null }>;
  let mean1000: number;
  if (r[0]?.m != null) {
    mean1000 = Math.round(r[0].m * 10); // reviews 0-100 → 0-1000
  } else {
    // 没有真实评价 → 用种子技师的服务分均值当先验
    const s = (await ctx.db.execute(
      sql`SELECT AVG(score_service)::float AS m FROM therapists WHERE score_service > 0`,
    )) as unknown as Array<{ m: number | null }>;
    mean1000 = s[0]?.m != null ? Math.round(s[0].m) : FALLBACK_PRIOR_1000;
  }
  _meanCache = { value: mean1000, expiresAt: now + 60_000 };
  return mean1000;
}

/** 清缓存(测试/回填用) */
export function clearMeanCache(): void {
  _meanCache = null;
}

export interface BayesResult {
  /** 贝叶斯加权服务分 · 0-1000 */
  bayes1000: number;
  /** 真实非隐藏评价数(不封顶) */
  count: number;
  /** 原始时间衰减加权服务分 · 0-1000(不含先验) */
  rawWeighted1000: number;
}

/**
 * 纯函数:给定一批评价(score_service 0-100 + createdAt)+ 先验均值,算贝叶斯加权分。
 * 抽成纯函数便于单测。
 */
export function computeBayes(
  items: Array<{ scoreService: number; createdAt: Date }>,
  priorMean1000: number,
  now = Date.now(),
): BayesResult {
  if (!items.length) return { bayes1000: priorMean1000, count: 0, rawWeighted1000: priorMean1000 };

  let wSum = 0;
  let wScoreSum = 0;
  for (const it of items) {
    const ageDays = Math.max(0, (now - it.createdAt.getTime()) / 86_400_000);
    const w = Math.pow(0.5, ageDays / DECAY_HALFLIFE_DAYS);
    const s1000 = it.scoreService * 10; // 0-100 → 0-1000
    wSum += w;
    wScoreSum += w * s1000;
  }
  const rawWeighted1000 = Math.round(wScoreSum / wSum);
  // 贝叶斯:(C·m + Σw·s) / (C + Σw)
  const bayes1000 = Math.round((PRIOR_WEIGHT * priorMean1000 + wScoreSum) / (PRIOR_WEIGHT + wSum));
  return { bayes1000, count: items.length, rawWeighted1000 };
}

/**
 * 重算单个技师的评分聚合并落库。
 * 有评价 → 写真实贝叶斯/均值/真实计数;0 评价 → 种子兜底(ratingBayes = 现有 scoreService,不清零)。
 */
export async function refreshTherapistRating(ctx: RatingContext, therapistId: string): Promise<void> {
  const list = await ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetTherapistId, therapistId), eq(reviews.isHidden, 0)),
    orderBy: [desc(reviews.createdAt)],
  });

  if (!list.length) {
    // 种子兜底:不动 scoreService/rating/ratingCount 种子,只把 ratingBayes 对齐 scoreService 供排序
    const [t] = await ctx.db
      .select({ scoreService: therapists.scoreService })
      .from(therapists)
      .where(eq(therapists.id, therapistId))
      .limit(1);
    if (t) {
      await ctx.db
        .update(therapists)
        .set({ ratingBayes: t.scoreService, updatedAt: new Date() })
        .where(eq(therapists.id, therapistId));
    }
    return;
  }

  const mean = await globalServiceMean1000(ctx);
  const { bayes1000, count } = computeBayes(
    list.map((r) => ({ scoreService: r.scoreService, createdAt: r.createdAt })),
    mean,
  );

  // 维度均值(reviews 0-100 → 0-1000)· 颜值/身材可能为 null(当前未采集)→ 有则算无则 0
  const avg1000 = (key: 'scoreService' | 'scoreAppearance' | 'scoreBody') => {
    const vals = list.map((r) => r[key]).filter((v): v is number => v != null && v > 0);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) : 0;
  };

  await ctx.db
    .update(therapists)
    .set({
      scoreService: avg1000('scoreService'),
      scoreAppearance: avg1000('scoreAppearance'),
      scoreBody: avg1000('scoreBody'),
      ratingBayes: bayes1000,
      rating: bayes1000, // legacy 列同步(种子语义即 0-1000)
      ratingCount: count, // 真实计数,不封顶
      updatedAt: new Date(),
    })
    .where(eq(therapists.id, therapistId));
}
