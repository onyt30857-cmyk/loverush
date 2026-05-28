/**
 * 推荐引擎 · M03 F03.10 + M04 匹配
 *
 * 流程：
 * 1. 候选召回：城市 + verification=passed + 在线/可用 + 不在封锁列表
 * 2. 评分排序：偏好命中、评分、亲密度档位（L0-L3）、行为 mode 调权
 * 3. LLM 重排（Top N 给 Claude 重排，结合自然语言上下文）
 *
 * 返回 1-3 个推荐，每个带"为什么推荐"的理由文本。
 */

import { and, eq, inArray, ne, sql, desc, gte } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  therapists,
  customerMasterPreferences,
  customerRelationshipProfile,
  customerBehaviorProfile,
  blockList,
  type Therapist,
} from '@loverush/db';

export interface RecommendContext {
  db: Database;
}

export interface RecommendParams {
  customerId: string;
  city?: string;
  topN?: number;
  intent?: string; // 自然语言意图（用于 LLM 重排）
}

export interface Candidate {
  therapist: Therapist;
  score: number;
  factors: Record<string, number>;
  reason?: string;
}

const DEFAULT_TOP_N = 3;
const RECALL_LIMIT = 30;

export async function recallCandidates(
  ctx: RecommendContext,
  p: RecommendParams,
): Promise<Therapist[]> {
  // 被封锁的技师 user_id（双向）
  const blockedBy = await ctx.db.query.blockList.findMany({
    where: eq(blockList.blockerUserId, p.customerId),
  });
  const blockedMe = await ctx.db.query.blockList.findMany({
    where: eq(blockList.blockedUserId, p.customerId),
  });
  const excludeUserIds = new Set<string>([
    ...blockedBy.map((b) => b.blockedUserId),
    ...blockedMe.map((b) => b.blockerUserId),
  ]);

  const conds = [
    eq(therapists.verificationStatus, 'passed'),
    ne(therapists.coolingStatus, 'cold'),
  ];
  if (p.city) conds.push(eq(therapists.serviceCity, p.city));

  const candidates = await ctx.db.query.therapists.findMany({
    where: and(...conds),
    orderBy: [desc(therapists.rating), desc(therapists.scoreService)],
    limit: RECALL_LIMIT,
  });

  return candidates.filter((t) => !excludeUserIds.has(t.userId));
}

export async function scoreCandidates(
  ctx: RecommendContext,
  p: RecommendParams,
  candidates: Therapist[],
): Promise<Candidate[]> {
  const masterPref = await ctx.db.query.customerMasterPreferences.findFirst({
    where: eq(customerMasterPreferences.userId, p.customerId),
  });
  const behavior = await ctx.db.query.customerBehaviorProfile.findFirst({
    where: eq(customerBehaviorProfile.userId, p.customerId),
  });

  // 关系画像（已合作过的技师）
  const relations = candidates.length
    ? await ctx.db.query.customerRelationshipProfile.findMany({
        where: and(
          eq(customerRelationshipProfile.customerId, p.customerId),
          inArray(customerRelationshipProfile.therapistId, candidates.map((c) => c.id)),
        ),
      })
    : [];
  const relationByTherapist = new Map(relations.map((r) => [r.therapistId, r]));

  const scored: Candidate[] = candidates.map((t) => {
    const factors: Record<string, number> = {};

    // 评分维度（满分 100）
    factors.rating = Math.min(100, t.rating / 5); // rating 满 500 → 100
    factors.completedOrders = Math.min(50, t.completedOrders);
    factors.scoreAppearance = t.scoreAppearance / 10;
    factors.scoreService = t.scoreService / 10;
    factors.profileCompleteness = t.profileCompleteness * 0.5;

    // 关系画像调权
    const rel = relationByTherapist.get(t.id);
    if (rel) {
      const tierBonus = { L0: 0, L1: 10, L2: 25, L3: 50 }[rel.tier] ?? 0;
      factors.relationship = tierBonus;
    }

    // 行为模式调权
    if (behavior) {
      if (behavior.behaviorMode === 'steady' && rel) {
        factors.behaviorBoost = 30; // steady 客户偏好熟人
      } else if (behavior.behaviorMode === 'explorer' && !rel) {
        factors.behaviorBoost = 25; // explorer 偏好新人
      }
    }

    // 偏好命中
    if (masterPref) {
      const styles = masterPref.serviceStylePrefs ?? [];
      const tags = t.tags ?? [];
      const hits = styles.filter((s) => tags.includes(s)).length;
      factors.preferenceHit = hits * 15;
    }

    // 在线优先
    if (t.onlineStatus === 'online') factors.online = 20;

    const score = Object.values(factors).reduce((a, b) => a + b, 0);
    return { therapist: t, score, factors };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export async function recommend(
  ctx: RecommendContext,
  p: RecommendParams,
): Promise<Candidate[]> {
  const candidates = await recallCandidates(ctx, p);
  if (!candidates.length) return [];
  const scored = await scoreCandidates(ctx, p, candidates);
  return scored.slice(0, p.topN ?? DEFAULT_TOP_N);
}
