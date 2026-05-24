/**
 * 评价 + 信誉 · M08
 *
 * submitReview：客户对完成订单发评价 → 同时刷新 therapists 三维评分 + reputation_scores
 * appealReview：技师对差评申诉
 *
 * 三维评分聚合用滑窗均值（近 N 条），避免大表全扫描。
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import {
  Database,
  reviews,
  reputationScores,
  therapists,
  orders,
  type Review,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { fireAndForget } from './logger';

export interface ReviewContext {
  db: Database;
}

const RECENT_WINDOW = 30;

export interface SubmitReviewArgs {
  orderId: string;
  reviewerUserId: string;
  scoreAppearance?: number; // 0-100
  scoreBody?: number;
  scoreService: number;
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

  const [row] = await ctx.db
    .insert(reviews)
    .values({
      orderId: args.orderId,
      reviewerUserId: args.reviewerUserId,
      targetType: 'therapist',
      targetUserId: order.therapistUserId,
      targetTherapistId: order.therapistId,
      scoreAppearance: args.scoreAppearance,
      scoreBody: args.scoreBody,
      scoreService: args.scoreService,
      content: args.content,
      tags: args.tags,
      isAnonymous: args.isAnonymous === false ? 0 : 1,
    })
    .returning();
  if (!row) throw HttpError.internal('review insert failed');

  // 异步更新评分
  fireAndForget(refreshTherapistScores(ctx, order.therapistId), 'reviews.refresh_scores_failed', { therapistId: order.therapistId });
  fireAndForget(refreshReputation(ctx, order.therapistUserId), 'reviews.refresh_reputation_failed', { therapistUserId: order.therapistUserId });

  return row;
}

async function refreshTherapistScores(ctx: ReviewContext, therapistId: string): Promise<void> {
  const recent = await ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetTherapistId, therapistId), eq(reviews.isHidden, 0)),
    orderBy: [desc(reviews.createdAt)],
    limit: RECENT_WINDOW,
  });
  if (!recent.length) return;

  const avg = (key: keyof Review) => {
    const vals = recent.map((r) => Number(r[key] ?? 0)).filter((v) => !Number.isNaN(v) && v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };

  await ctx.db
    .update(therapists)
    .set({
      scoreAppearance: avg('scoreAppearance'),
      scoreBody: avg('scoreBody'),
      scoreService: avg('scoreService'),
      ratingCount: recent.length,
      rating: avg('scoreService') * 5, // 0-500 (服务分 ×5 兜底)
      updatedAt: new Date(),
    })
    .where(eq(therapists.id, therapistId));
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

export async function listReviewsForTherapist(
  ctx: ReviewContext,
  args: { therapistId: string; limit?: number; offset?: number },
): Promise<Review[]> {
  return ctx.db.query.reviews.findMany({
    where: and(eq(reviews.targetTherapistId, args.therapistId), eq(reviews.isHidden, 0)),
    orderBy: [desc(reviews.createdAt)],
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
  });
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
