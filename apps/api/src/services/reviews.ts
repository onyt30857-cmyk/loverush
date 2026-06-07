/**
 * 评价 + 信誉 · M08
 *
 * submitReview：客户对完成订单发评价 → 同时刷新 therapists 三维评分 + reputation_scores
 * appealReview：技师对差评申诉
 *
 * 三维评分聚合用滑窗均值（近 N 条），避免大表全扫描。
 */

import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  reviews,
  reputationScores,
  therapists,
  orders,
  type Review,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { fireAndForget } from './logger';
import { refreshTherapistRating } from './rating';

export interface ReviewContext {
  db: Database;
}

const RECENT_WINDOW = 30;

export interface SubmitReviewArgs {
  orderId: string;
  reviewerUserId: string;
  /** 总分(必填,0-100=5星×20)· 贝叶斯主分 */
  scoreOverall: number;
  /** 体验向四维(0-100,可选)· 服务/态度/真人符合度/守时 */
  scoreService?: number;
  scoreAttitude?: number;
  scoreAuthenticity?: number;
  scorePunctuality?: number;
  content?: string;
  tags?: string[];
  isAnonymous?: boolean;
}

export async function submitReview(
  ctx: ReviewContext,
  args: SubmitReviewArgs,
): Promise<Review> {
  const order = await ctx.db.query.orders.findFirst({ where: eq(orders.id, args.orderId) });
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (order.customerId !== args.reviewerUserId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your order');
  }
  if (!['COMPLETED', 'REVIEWED'].includes(order.status)) {
    throw HttpError.conflict(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'order not completed');
  }

  // 重复提交（同 order + reviewer）报错
  const existing = await ctx.db.query.reviews.findFirst({
    where: and(eq(reviews.orderId, args.orderId), eq(reviews.reviewerUserId, args.reviewerUserId)),
  });
  if (existing) {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, 'already reviewed');
  }

  // service 维度缺省回退总分(score_service 列 NOT NULL,且 服务 是四维之一)
  const scoreService = args.scoreService ?? args.scoreOverall;

  const [row] = await ctx.db
    .insert(reviews)
    .values({
      orderId: args.orderId,
      reviewerUserId: args.reviewerUserId,
      targetType: 'therapist',
      targetUserId: order.therapistUserId,
      targetTherapistId: order.therapistId,
      scoreOverall: args.scoreOverall,
      scoreService,
      scoreAttitude: args.scoreAttitude,
      scoreAuthenticity: args.scoreAuthenticity,
      scorePunctuality: args.scorePunctuality,
      content: args.content,
      tags: args.tags,
      isAnonymous: args.isAnonymous === false ? 0 : 1,
    })
    .returning();
  if (!row) throw HttpError.internal('review insert failed');

  // 统一通道:同步订单评分字段 + COMPLETED→REVIEWED(收口原 POST /orders/:id/review 双调)
  await ctx.db
    .update(orders)
    .set({
      customerRating: Math.max(1, Math.min(5, Math.round(args.scoreOverall / 20))),
      customerReview: args.content ?? null,
      reviewedAt: new Date(),
      ...(order.status === 'COMPLETED' ? { status: 'REVIEWED' as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, args.orderId));

  // 异步更新评分
  fireAndForget(refreshTherapistScores(ctx, order.therapistId), 'reviews.refresh_scores_failed', { therapistId: order.therapistId });
  fireAndForget(refreshReputation(ctx, order.therapistUserId), 'reviews.refresh_reputation_failed', { therapistUserId: order.therapistUserId });

  return row;
}

// 委托给科学评分引擎(贝叶斯 + 时间衰减 + 真实计数 + 种子兜底)· 见 services/rating.ts
async function refreshTherapistScores(ctx: ReviewContext, therapistId: string): Promise<void> {
  await refreshTherapistRating(ctx, therapistId);
}

async function refreshReputation(ctx: ReviewContext, therapistUserId: string): Promise<void> {
  const list = await ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetUserId, therapistUserId), eq(reviews.isHidden, 0)),
    orderBy: [desc(reviews.createdAt)],
    limit: RECENT_WINDOW,
  });

  const avgService = list.length
    ? Math.round(list.map((r) => r.scoreService ?? 0).reduce((a, b) => a + b, 0) / list.length)
    : 0;
  const avgAppearance = list.length
    ? Math.round(
        list
          .filter((r) => r.scoreAppearance != null)
          .map((r) => r.scoreAppearance!)
          .reduce((a, b) => a + b, 0) / Math.max(1, list.filter((r) => r.scoreAppearance != null).length),
      )
    : 0;
  const avgBody = list.length
    ? Math.round(
        list
          .filter((r) => r.scoreBody != null)
          .map((r) => r.scoreBody!)
          .reduce((a, b) => a + b, 0) / Math.max(1, list.filter((r) => r.scoreBody != null).length),
      )
    : 0;

  // overall: 0-1000，加权服务 50% + 颜值 25% + 身材 25%
  const overall = Math.round(avgService * 5 + avgAppearance * 2.5 + avgBody * 2.5);

  await ctx.db
    .insert(reputationScores)
    .values({
      userId: therapistUserId,
      overall,
      scoreAppearance: avgAppearance,
      scoreBody: avgBody,
      scoreService: avgService,
      sampleSize: list.length,
      lastComputedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: reputationScores.userId,
      set: {
        overall,
        scoreAppearance: avgAppearance,
        scoreBody: avgBody,
        scoreService: avgService,
        sampleSize: list.length,
        lastComputedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export interface PublicReviewItem {
  id: string;
  reviewerUserId: string;
  /** 匿名评价不暴露昵称 */
  customerDisplayName: string | null;
  scoreOverall: number;
  scoreService: number;
  scoreAttitude: number | null;
  scoreAuthenticity: number | null;
  scorePunctuality: number | null;
  content: string | null;
  tags: string[] | null;
  createdAt: string;
}

export async function listReviewsForTherapist(
  ctx: ReviewContext,
  args: { therapistId: string; limit?: number; offset?: number },
): Promise<PublicReviewItem[]> {
  // P2 安全 · 已下架技师评价不再公开 · 跟 getTherapistView 404 行为一致
  const t = await ctx.db.query.therapists.findFirst({
    where: eq(therapists.id, args.therapistId),
  });
  if (!t) return [];
  const { users } = await import('@loverush/db');
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
  if (!u || u.status !== 'active') return [];

  const rows = await ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetTherapistId, args.therapistId), eq(reviews.isHidden, 0)),
    orderBy: [desc(reviews.createdAt)],
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
  });
  if (!rows.length) return [];

  // 批量取非匿名评价人昵称(避免 N+1)
  const namedIds = [...new Set(rows.filter((r) => r.isAnonymous !== 1).map((r) => r.reviewerUserId))];
  const nameRows = namedIds.length
    ? await ctx.db.query.users.findMany({ where: inArray(users.id, namedIds) })
    : [];
  const nameById = new Map(nameRows.map((x) => [x.id, x.displayName]));

  return rows.map((r) => ({
    id: r.id,
    reviewerUserId: r.reviewerUserId,
    customerDisplayName: r.isAnonymous === 1 ? null : (nameById.get(r.reviewerUserId) ?? null),
    scoreOverall: r.scoreOverall ?? r.scoreService,
    scoreService: r.scoreService,
    scoreAttitude: r.scoreAttitude,
    scoreAuthenticity: r.scoreAuthenticity,
    scorePunctuality: r.scorePunctuality,
    content: r.content,
    tags: r.tags,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface ReceivedReviewItem {
  id: string;
  customerDisplayName: string | null; // 匿名为 null
  scoreOverall: number;
  scoreService: number;
  scoreAttitude: number | null;
  scoreAuthenticity: number | null;
  scorePunctuality: number | null;
  content: string | null;
  tags: string[] | null;
  appealStatus: string | null; // null/pending/resolved/rejected
  createdAt: string;
}

/** 技师收到的评价(技师端"我的评价"页)· 含申诉状态,不含已隐藏 */
export async function getReceivedReviews(
  ctx: ReviewContext,
  therapistUserId: string,
): Promise<ReceivedReviewItem[]> {
  const rows = await ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetUserId, therapistUserId), eq(reviews.isHidden, 0)),
    orderBy: [desc(reviews.createdAt)],
    limit: 100,
  });
  if (!rows.length) return [];
  const { users } = await import('@loverush/db');
  const namedIds = [...new Set(rows.filter((r) => r.isAnonymous !== 1).map((r) => r.reviewerUserId))];
  const nameRows = namedIds.length
    ? await ctx.db.query.users.findMany({ where: inArray(users.id, namedIds) })
    : [];
  const nameById = new Map(nameRows.map((x) => [x.id, x.displayName]));
  return rows.map((r) => ({
    id: r.id,
    customerDisplayName: r.isAnonymous === 1 ? null : (nameById.get(r.reviewerUserId) ?? null),
    scoreOverall: r.scoreOverall ?? r.scoreService,
    scoreService: r.scoreService,
    scoreAttitude: r.scoreAttitude,
    scoreAuthenticity: r.scoreAuthenticity,
    scorePunctuality: r.scorePunctuality,
    content: r.content,
    tags: r.tags,
    appealStatus: r.appealStatus,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface TherapistReviewSummary {
  count: number;
  /** 各维度均值 0-100 · 无数据为 null(冷启动/未采集) */
  dimensions: {
    overall: number | null;
    service: number | null;
    attitude: number | null;
    authenticity: number | null;
    punctuality: number | null;
  };
  /** 总分星级分布 [1星,2星,3星,4星,5星] 计数 */
  distribution: [number, number, number, number, number];
}

/** 技师评价汇总(读时算)· 给详情页 4 维展示 + 后台技师级视图复用 */
export async function getTherapistReviewSummary(
  ctx: ReviewContext,
  therapistId: string,
): Promise<TherapistReviewSummary> {
  const list = await ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetTherapistId, therapistId), eq(reviews.isHidden, 0)),
  });
  const empty: TherapistReviewSummary = {
    count: 0,
    dimensions: { overall: null, service: null, attitude: null, authenticity: null, punctuality: null },
    distribution: [0, 0, 0, 0, 0],
  };
  if (!list.length) return empty;

  const avg = (vals: Array<number | null | undefined>): number | null => {
    const v = vals.filter((x): x is number => x != null && x > 0);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of list) {
    const star = Math.max(1, Math.min(5, Math.round((r.scoreOverall ?? r.scoreService) / 20)));
    distribution[star - 1] = (distribution[star - 1] ?? 0) + 1;
  }
  return {
    count: list.length,
    dimensions: {
      overall: avg(list.map((r) => r.scoreOverall ?? r.scoreService)),
      service: avg(list.map((r) => r.scoreService)),
      attitude: avg(list.map((r) => r.scoreAttitude)),
      authenticity: avg(list.map((r) => r.scoreAuthenticity)),
      punctuality: avg(list.map((r) => r.scorePunctuality)),
    },
    distribution,
  };
}

export async function appealReview(
  ctx: ReviewContext,
  args: { reviewId: string; therapistUserId: string; reason: string },
): Promise<Review> {
  const r = await ctx.db.query.reviews.findFirst({ where: eq(reviews.id, args.reviewId) });
  if (!r) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'review not found');
  if (r.targetUserId !== args.therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your review');
  }
  if (r.appealStatus === 'pending') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, 'appeal already pending');
  }

  const [updated] = await ctx.db
    .update(reviews)
    .set({
      appealStatus: 'pending',
      appealReason: args.reason,
      appealedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reviews.id, args.reviewId))
    .returning();
  return updated!;
}

export async function resolveAppeal(
  ctx: ReviewContext,
  args: { reviewId: string; adminUserId: string; outcome: 'uphold' | 'hide'; note: string },
): Promise<Review> {
  const r = await ctx.db.query.reviews.findFirst({ where: eq(reviews.id, args.reviewId) });
  if (!r) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'review not found');
  if (r.appealStatus !== 'pending') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, 'no pending appeal');
  }

  const [updated] = await ctx.db
    .update(reviews)
    .set({
      appealStatus: args.outcome === 'hide' ? 'resolved' : 'rejected',
      appealResolution: args.note,
      isHidden: args.outcome === 'hide' ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(reviews.id, args.reviewId))
    .returning();

  // 隐藏的评价从评分聚合中剔除 → 重算
  if (args.outcome === 'hide' && r.targetTherapistId) {
    fireAndForget(refreshTherapistScores(ctx, r.targetTherapistId), 'reviews.refresh_scores_failed', { therapistId: r.targetTherapistId });
    fireAndForget(refreshReputation(ctx, r.targetUserId), 'reviews.refresh_reputation_failed', { therapistUserId: r.targetUserId });
  }
  return updated!;
}
