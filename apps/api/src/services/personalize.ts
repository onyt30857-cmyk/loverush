/**
 * 搜索结果个性化排序 · Phase 3
 *
 * 输入:候选技师列表(已通过 verification + 筛选条件)+ 客户 ID
 * 输出:同样的技师 · 按个性化分数重排序 + 每个技师附 match_reason
 *
 * 评分维度(每个技师 score = sum):
 *  1. **历史复购**(最强信号)
 *     客户跟该技师约过(orders.completed)→ +50
 *  2. **L4 关系层评价**
 *     客户对该技师有 relation 记忆 → +importance × 5 + content 含好评关键词额外加分
 *  3. **偏好匹配**(stable_prefs)
 *     - 技师 language 命中客户 priorities → +20
 *     - 技师 nationality 命中客户 priorities → +20
 *     - 技师 service_city 命中客户 facts.city → +15
 *     - 技师 score_service ≥ 客户 priorities 中的"评分高"门槛 → +10
 *  4. **偏好规避**(stable_prefs.dislikes)
 *     - 技师 nationality / language / skill 命中客户 dislikes → -100(强避雷)
 *  5. **价格匹配**
 *     - 技师 price 在客户 price_band 内 → +10(待 price 字段确认 · 暂略)
 *  6. **行为模式**
 *     - stable 客户:历史浏览过的技师 → +15
 *     - exploratory 客户:首次见的技师 → +10(鼓励探索)
 *  7. **基础分**
 *     - score_service / 10(0-5 分)
 *     - online_status='online' → +5
 *
 * 输出 reasons[]:用户可见的"为什么推荐"
 *  - "上次约过 ★4.5"
 *  - "同城 · 中文沟通"
 *  - "评分高 · 4.9★"
 */

import { eq, sql, and, inArray } from 'drizzle-orm';
import {
  customerSavedMemory,
  customerReferenceMemory,
  customerBehaviorProfile,
  orders,
} from '@loverush/db';

interface TherapistCandidate {
  id: string;
  userId: string;
  displayName: string | null;
  serviceCity: string | null;
  nationality: string | null;
  languages: string[] | null;
  scoreService: number;
  onlineStatus: string;
}

export interface PersonalizedResult<T extends TherapistCandidate> {
  therapist: T;
  score: number;
  reasons: string[];
}

interface PersonalizeContext {
  db: import('@loverush/db').Database;
}

interface StablePrefs {
  dislikes?: string[];
  priorities?: string[];
  price_band?: { min: number; max: number };
}

interface SavedFacts {
  city?: string;
  language?: string;
}

/**
 * 主入口:给候选技师重排序
 */
export async function personalizeRanking<T extends TherapistCandidate>(
  ctx: PersonalizeContext,
  userId: string,
  candidates: T[],
): Promise<PersonalizedResult<T>[]> {
  if (candidates.length === 0) return [];

  // 1. 拉客户 L1+L2(stable_prefs / facts)
  const saved = await ctx.db.query.customerSavedMemory.findFirst({
    where: eq(customerSavedMemory.userId, userId),
  });
  const stablePrefs = (saved?.stablePrefs ?? {}) as StablePrefs;
  const facts = (saved?.facts ?? {}) as SavedFacts;

  // 2. 拉客户 L4 关系层(对这些候选的记忆) · refTherapistId 指向 therapists.id
  const candidateUserIds = candidates.map((c) => c.userId);
  const candidateIds = candidates.map((c) => c.id);
  const relations = await ctx.db
    .select({
      refTherapistId: customerReferenceMemory.refTherapistId,
      content: customerReferenceMemory.content,
      importance: customerReferenceMemory.importance,
    })
    .from(customerReferenceMemory)
    .where(
      and(
        eq(customerReferenceMemory.userId, userId),
        eq(customerReferenceMemory.memoryType, 'relation'),
        inArray(customerReferenceMemory.refTherapistId, candidateIds),
      ),
    );
  const relationsByTherapist = new Map<string, { content: string; importance: number }[]>();
  for (const r of relations) {
    if (!r.refTherapistId) continue;
    const arr = relationsByTherapist.get(r.refTherapistId) ?? [];
    arr.push({ content: r.content, importance: r.importance });
    relationsByTherapist.set(r.refTherapistId, arr);
  }

  // 3. 拉客户历史完成订单(跟哪些技师约过)
  const completedOrders = (await ctx.db
    .select({
      therapistUserId: orders.therapistUserId,
    })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, userId),
        inArray(orders.status, ['COMPLETED', 'REVIEWED']),
        inArray(orders.therapistUserId, candidateUserIds),
      ),
    )) as Array<{ therapistUserId: string }>;
  const bookedTherapistUserIds = new Set(completedOrders.map((o) => o.therapistUserId));

  // 4. 客户行为模式
  const behavior = await ctx.db.query.customerBehaviorProfile.findFirst({
    where: eq(customerBehaviorProfile.userId, userId),
  });
  const mode = behavior?.behaviorMode ?? 'mixed';

  // 5. 浏览次数(近 30d)· 通过 analytics_events 查询
  const viewedTherapistIds = new Set<string>();
  try {
    const views = (await ctx.db.execute(sql`
      SELECT DISTINCT ref_id::text
      FROM analytics_events
      WHERE actor_user_id = ${userId}
        AND event_name = 'therapist_view'
        AND occurred_at >= NOW() - INTERVAL '30 days'
    `)) as Array<{ ref_id: string }>;
    for (const v of views) viewedTherapistIds.add(v.ref_id);
  } catch {
    // analytics_events 不可用 · 静默
  }

  // 6. 评分每个候选
  const scored: PersonalizedResult<T>[] = candidates.map((t) => {
    const reasons: string[] = [];
    let score = 0;

    // 基础分(0-5)
    score += t.scoreService / 10;

    // 在线加分
    if (t.onlineStatus === 'online') {
      score += 5;
      reasons.push('在线');
    }

    // 历史复购(最强)
    if (bookedTherapistUserIds.has(t.userId)) {
      score += 50;
      reasons.push('约过 · 老熟人');
    }

    // L4 关系层 · key 是 therapists.id
    const rels = relationsByTherapist.get(t.id) ?? [];
    if (rels.length > 0) {
      const avgImportance = rels.reduce((sum, r) => sum + r.importance, 0) / rels.length;
      score += avgImportance * 5;
      // 内容含"好"/"棒"/"满意"/"喜欢" → 额外加分
      const hasGoodKeywords = rels.some((r) =>
        /好|棒|满意|喜欢|舒服|顶|绝|赞|手法.{0,3}对/.test(r.content),
      );
      if (hasGoodKeywords) {
        score += 15;
        if (!reasons.includes('约过 · 老熟人')) reasons.push('你上次说好');
      }
    }

    // 偏好匹配(priorities)
    const priorities = stablePrefs.priorities ?? [];
    const hasLanguageMatch = priorities.some(
      (p) => t.languages && t.languages.some((l) => l.includes(p) || p.includes(l)),
    );
    if (hasLanguageMatch) {
      score += 20;
      reasons.push('语言匹配');
    }

    const hasNationalityMatch = priorities.some(
      (p) => t.nationality && (t.nationality.includes(p) || p.includes(t.nationality)),
    );
    if (hasNationalityMatch) {
      score += 20;
    }

    // 同城
    if (facts.city && t.serviceCity === facts.city) {
      score += 15;
      reasons.push('同城');
    }

    // 偏好规避(dislikes)
    const dislikes = stablePrefs.dislikes ?? [];
    const hitDislike = dislikes.some(
      (d) =>
        (t.nationality && t.nationality.includes(d)) ||
        (t.languages && t.languages.some((l) => l.includes(d))),
    );
    if (hitDislike) {
      score -= 100; // 强避雷
    }

    // 行为模式 · steady=回头客倾向 / explorer=尝鲜倾向
    const viewed = viewedTherapistIds.has(t.id);
    if (mode === 'steady' && viewed) {
      score += 15;
    } else if (mode === 'explorer' && !viewed) {
      score += 10;
      if (!reasons.includes('在线') && rels.length === 0) {
        reasons.push('新发现');
      }
    }

    // 评分高(基础质量信号)
    if (t.scoreService >= 45) {
      if (!reasons.length) reasons.push(`${(t.scoreService / 10).toFixed(1)}★ 口碑稳`);
    }

    return { therapist: t, score, reasons: reasons.slice(0, 2) }; // 最多 2 条 reasons
  });

  // 7. 排序
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
