/**
 * 1→3 精准匹配 + 推荐理由 · 对齐 0522 信息采集表
 *
 * 算法:
 *   1. 调 services/recommend.ts 的现有打分(已含偏好命中/关系/行为模式/在线优先)
 *   2. 多兴趣簇并取召回(每簇 Top N)→ 去重 → 二次合并
 *   3. L5 diff 权重叠乘
 *   4. **0522 文档新维度 boost**(本次新增):
 *      - primary_focus(主要关注)→ 按用户最在意的维度加权
 *      - 外形命中(height_pref / body_type / look_style)→ tags + heightCm 命中
 *      - nationality_pref → 技师国籍匹配
 *      - tip_band → 小费高优先推热门技师(0522 文档原话)
 *   5. Haiku 给每候选生成 50 字推荐理由 + 重排
 *
 * 返回:topN(默认 3)· 每个含 reason + factor breakdown
 */

import type { LLMGateway } from '@loverush/llm';
import type { Database } from '@loverush/db';
import { recommend as baseRecommend, type Candidate, type RecommendContext } from '../recommend';
import { readReference, readSaved, type MemoryContext } from './memory';
import { diffsToWeights } from './diff';
import { readClusters } from './clusterer';

export interface RecommenderContext extends RecommendContext, MemoryContext {
  db: Database;
}

export interface RecommendArgs {
  userId: string;
  city?: string;
  intent?: string;
  topN?: number;
}

export interface RecommendedItem extends Candidate {
  reason: string;
  clusterIdx?: number;
  weight: number;
}

const REASON_SYS = `你是按摩平台的推荐理由生成器 · 风格"好哥们" · PRD §5。

输入:技师 brief + 客户最近的关系层片段 + 客户当前意图。
输出:一句 30-50 字的中文推荐理由 · 直接称"你" · 不用"您" · 不背模板。

规则:
- 引用客户的具体偏好 / 上次评价(给出"为什么是 ta")
- 不夸客户("您说得太对了""完美的选择" 全禁)
- 不用 "作为 AI" 类自指
- 不堆 emoji
- 一句话搞定 · 不分段`;

const REASON_FALLBACK = '风格和你之前喜欢的接近 · 这个时段也有空';

async function genReason(
  gateway: LLMGateway,
  userId: string,
  args: {
    therapistBrief: string;
    intent?: string;
    relationSnippet?: string;
    clusterLabel?: string;
  },
): Promise<string> {
  const user = [
    `技师:${args.therapistBrief}`,
    args.relationSnippet ? `你最近的反馈:${args.relationSnippet}` : null,
    args.clusterLabel ? `命中你的兴趣簇:${args.clusterLabel}` : null,
    args.intent ? `你刚说:${args.intent}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await gateway.complete({
      tier: 'T2',
      system: REASON_SYS,
      messages: [{ role: 'user', content: user }],
      maxTokens: 80,
      temperature: 0.6,
      userId,
      tag: 'assistant.reason',
    });
    const text = res.content.trim();
    return text || REASON_FALLBACK;
  } catch {
    return REASON_FALLBACK;
  }
}

// ──────────────── 0522 维度 boost helpers ────────────────

type Facts = Record<string, unknown>;

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

function notAny(xs: string[]): string[] {
  return xs.filter((x) => x && x !== 'any');
}

/**
 * 主要关注权重(锚定 0522 文档:"我会优先按这个权重来推")
 * focus = ['looks', 'skill'] → 颜值/手法分维度加权
 * 上限 1.5×(防止单维度过拉)
 */
function focusBoost(facts: Facts, c: Candidate): number {
  const focus = notAny(arr(facts.primary_focus));
  if (focus.length === 0) return 1;
  const t = c.therapist;
  let boost = 1;
  for (const f of focus) {
    if (f === 'looks') boost += t.scoreAppearance / 2000; // 满 1000 → +0.5
    else if (f === 'skill' || f === 'service') boost += t.scoreService / 2000;
    else if (f === 'vibe') {
      // service_style 命中 tags 加成
      const wanted = notAny(arr(facts.service_style));
      const tags = t.tags ?? [];
      const hits = wanted.filter((w) => tags.includes(w)).length;
      boost += Math.min(hits * 0.1, 0.3);
    } else if (f === 'privacy') {
      // 暂无 privacy_score 字段 · 用 verification + completedOrders 间接
      if (t.completedOrders > 30) boost += 0.05;
    }
  }
  return Math.min(boost, 1.5);
}

/**
 * 外形命中(0522 文档:身高 / 体型 / 胸围 / 颜值风格 / 年龄)
 * 每命中一维 +5% · 累加上限 +30%
 */
function physicalBoost(facts: Facts, c: Candidate): number {
  const t = c.therapist;
  let bonus = 0;

  // 身高范围命中(facts.height_pref 形如 ['160-164', '165-169'])
  const hP = notAny(arr(facts.height_pref));
  if (hP.length > 0 && t.heightCm) {
    if (hP.some((p) => matchHeightRange(p, t.heightCm!))) bonus += 0.05;
  }

  // tags 数组命中(体型 + 颜值风格 + 服务风格 + 服务力度都进 tags)
  const tags = t.tags ?? [];
  const wantTags = [
    ...notAny(arr(facts.body_type)),
    ...notAny(arr(facts.look_style)),
    ...notAny(arr(facts.service_style)),
    ...notAny(arr(facts.service_strength)),
  ];
  const hitCount = wantTags.filter((w) => tags.includes(w)).length;
  bonus += Math.min(hitCount * 0.05, 0.20);

  return Math.min(bonus, 0.30);
}

function matchHeightRange(pref: string, cm: number): boolean {
  if (pref === '<=159') return cm <= 159;
  if (pref === '>=170') return cm >= 170;
  const m = pref.match(/^(\d+)-(\d+)$/);
  if (!m) return false;
  const lo = parseInt(m[1]!, 10);
  const hi = parseInt(m[2]!, 10);
  return cm >= lo && cm <= hi;
}

/** 国籍命中:+10% */
function nationalityBoost(facts: Facts, c: Candidate): number {
  const np = notAny(arr(facts.nationality_pref));
  if (np.length === 0) return 0;
  const t = c.therapist;
  return t.nationality && np.includes(t.nationality) ? 0.10 : 0;
}

/**
 * 小费档位 boost(0522 文档原话:
 *   "小费金额越高 · 系统优先推荐最符合你偏好的热门技师")
 *
 * 热门指标 = rating(0-500) + 完成单 × 5,标准化到 0-1。
 * 小费 50-100 → 热门权重 ×0.10;200+ → ×0.20。
 */
function tipBoost(facts: Facts, c: Candidate): number {
  const tip = String(facts.tip_band ?? 'none');
  if (tip === 'none' || tip === '') return 0;
  const t = c.therapist;
  const popularity = Math.min((t.rating + t.completedOrders * 5) / 1000, 1);
  const tipMul: Record<string, number> = {
    '20-50': 0.05,
    '50-100': 0.10,
    '100-200': 0.15,
    '200+': 0.20,
  };
  return popularity * (tipMul[tip] ?? 0);
}

// ──────────────── 主入口 ────────────────

export async function recommend(
  ctx: RecommenderContext,
  gateway: LLMGateway,
  args: RecommendArgs,
): Promise<RecommendedItem[]> {
  const topN = args.topN ?? 3;

  // 1. 基础打分 · 召 20 个
  const baseCandidates = await baseRecommend(ctx, {
    customerId: args.userId,
    city: args.city,
    intent: args.intent,
    topN: 20,
  });
  if (!baseCandidates.length) return [];

  // 2. 多兴趣簇加权
  const clusters = await readClusters(ctx, args.userId);
  const clusterByIdx = new Map(clusters.map((c) => [c.clusterIdx, c]));

  // 3. L5 diff 权重
  const diffs = await readReference(ctx, args.userId, 'diff', 20);
  const diffWeights = diffsToWeights(
    diffs.map((d) => ({ refTherapistId: d.refTherapistId, content: d.content })),
  );

  // 3.5 · 0522 文档新维度 · 读 saved memory facts
  const saved = await readSaved(ctx, args.userId);
  const facts: Facts = (saved?.facts ?? {}) as Facts;

  // 4. 二次评分:cluster + diff + 0522 维度
  const enriched: Array<RecommendedItem> = baseCandidates.map((c) => {
    const tags = c.therapist.tags ?? [];
    let bestCluster: typeof clusters[0] | undefined;
    let bestOverlap = 0;
    for (const cl of clusters) {
      const overlap = (cl.topEntities ?? []).filter((e) => tags.includes(e)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCluster = cl;
      }
    }
    const clusterBoost = bestCluster ? bestCluster.weight / 100 : 1;
    const diffMultiplier = diffWeights.get(c.therapist.id) ?? 1;

    // 0522 文档维度
    const focus = focusBoost(facts, c);
    const physical = physicalBoost(facts, c);
    const nation = nationalityBoost(facts, c);
    const tip = tipBoost(facts, c);
    const facetBonus = 1 + physical + nation + tip;

    const finalScore = c.score * clusterBoost * diffMultiplier * focus * facetBonus;
    return {
      ...c,
      factors: {
        ...c.factors,
        clusterBoost: Math.round((clusterBoost - 1) * 100),
        diffMultiplier: Math.round((diffMultiplier - 1) * 100),
        focusBoost: Math.round((focus - 1) * 100),
        physicalBoost: Math.round(physical * 100),
        nationalityBoost: Math.round(nation * 100),
        tipBoost: Math.round(tip * 100),
      },
      reason: '',
      clusterIdx: bestCluster?.clusterIdx,
      weight: finalScore,
    };
  });

  enriched.sort((a, b) => b.weight - a.weight);
  const top = enriched.slice(0, topN);

  // 5. 给 Top N 生成理由(并发)
  const relations = await readReference(ctx, args.userId, 'relation', 5);
  const relationSnippetByT = new Map<string, string>();
  for (const r of relations) {
    if (r.refTherapistId && !relationSnippetByT.has(r.refTherapistId)) {
      relationSnippetByT.set(r.refTherapistId, r.content);
    }
  }

  const reasons = await Promise.all(
    top.map(async (item) => {
      const cluster = item.clusterIdx ? clusterByIdx.get(item.clusterIdx) : undefined;
      const brief = [
        `id ${item.therapist.id.slice(0, 8)}`,
        `城市:${item.therapist.serviceCity ?? '-'}`,
        `评分:${item.therapist.rating}`,
        `tags:${(item.therapist.tags ?? []).slice(0, 3).join(',')}`,
      ].join(' · ');
      return genReason(gateway, args.userId, {
        therapistBrief: brief,
        intent: args.intent,
        relationSnippet: relationSnippetByT.get(item.therapist.id),
        clusterLabel: cluster?.label ?? undefined,
      });
    }),
  );

  return top.map((item, i) => ({ ...item, reason: reasons[i]! }));
}
