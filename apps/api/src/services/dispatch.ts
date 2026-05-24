/**
 * 派单服务 · M04
 *
 * 客户发起即时订单 → 系统对 Top-K 候选技师广播 dispatch_offer →
 * 技师 accept 后订单锁定到该技师，其他 offer 标 superseded。
 *
 * 预约场景：客户指定单个技师，跳过广播，直接 PENDING_CONFIRM。
 */

import { and, eq, ne, isNull, gte } from 'drizzle-orm';
import {
  Database,
  dispatchOffers,
  orders,
  therapists,
  type DispatchOffer,
  type Order,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { recommend, type RecommendContext } from './recommend';
import { appendChainEvent } from './chain';

export interface DispatchContext {
  db: Database;
}

const DISPATCH_TTL_MS = 5 * 60 * 1000; // 5 分钟
const DEFAULT_FANOUT = 5;

/** 即时派单：根据推荐选 Top-K，给每个候选技师建 dispatch_offer */
export async function broadcastDispatch(
  ctx: DispatchContext,
  args: { order: Order; fanout?: number; city?: string },
): Promise<DispatchOffer[]> {
  const candidates = await recommend({ db: ctx.db } as RecommendContext, {
    customerId: args.order.customerId,
    city: args.city,
    topN: args.fanout ?? DEFAULT_FANOUT,
  });

  if (!candidates.length) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'no available therapist');
  }

  const expiresAt = new Date(Date.now() + DISPATCH_TTL_MS);

  const offers = await ctx.db
    .insert(dispatchOffers)
    .values(
      candidates.map((c) => ({
        orderId: args.order.id,
        customerId: args.order.customerId,
        therapistId: c.therapist.id,
        therapistUserId: c.therapist.userId,
        status: 'pending',
        matchScore: Math.round(c.score),
        matchFactors: c.factors,
        expiresAt,
      })),
    )
    .returning();

  await appendChainEvent(ctx.db, {
    orderId: args.order.id,
    event: 'order_created',
    payload: {
      dispatch: 'broadcast',
      fanout: offers.length,
      candidates: offers.map((o) => ({ therapistId: o.therapistId, score: o.matchScore })),
    },
    actorUserId: args.order.customerId,
    actorRole: 'system',
  });

  return offers;
}

/** 技师接受派单 → 该订单锁定到此技师；其他 offer 标 superseded */
export async function acceptDispatch(
  ctx: DispatchContext,
  args: { offerId: string; therapistUserId: string },
): Promise<{ offer: DispatchOffer; order: Order }> {
  const offer = await ctx.db.query.dispatchOffers.findFirst({
    where: eq(dispatchOffers.id, args.offerId),
  });
  if (!offer) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'offer not found');
  if (offer.therapistUserId !== args.therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your offer');
  }
  if (offer.status !== 'pending') {
    throw HttpError.conflict(ErrorCode.E3050_ORDER_STATE_ILLEGAL, `offer already ${offer.status}`);
  }
  if (offer.expiresAt.getTime() < Date.now()) {
    throw HttpError.conflict(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'offer expired');
  }

  // 抢占：使用乐观锁。先标自己的 offer = accepted，再批量把同 order 其他 offer 标 superseded。
  const [accepted] = await ctx.db
    .update(dispatchOffers)
    .set({ status: 'accepted', respondedAt: new Date() })
    .where(and(eq(dispatchOffers.id, offer.id), eq(dispatchOffers.status, 'pending')))
    .returning();
  if (!accepted) {
    throw HttpError.conflict(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'offer already taken');
  }

  await ctx.db
    .update(dispatchOffers)
    .set({ status: 'superseded', respondedAt: new Date() })
    .where(
      and(
        eq(dispatchOffers.orderId, offer.orderId),
        ne(dispatchOffers.id, offer.id),
        eq(dispatchOffers.status, 'pending'),
      ),
    );

  // 订单切换到 PENDING_CONFIRM，并把技师固定到此技师
  const [order] = await ctx.db
    .update(orders)
    .set({
      therapistId: offer.therapistId,
      therapistUserId: offer.therapistUserId,
      status: 'PENDING_CONFIRM',
      updatedAt: new Date(),
    })
    .where(eq(orders.id, offer.orderId))
    .returning();

  if (!order) throw HttpError.internal('order lock failed');

  await appendChainEvent(ctx.db, {
    orderId: order.id,
    event: 'order_created',
    payload: { action: 'dispatch_accepted', therapistId: offer.therapistId },
    actorUserId: args.therapistUserId,
    actorRole: 'therapist',
  });

  return { offer: accepted, order };
}

export async function declineDispatch(
  ctx: DispatchContext,
  args: { offerId: string; therapistUserId: string; reason?: string },
): Promise<DispatchOffer> {
  const offer = await ctx.db.query.dispatchOffers.findFirst({
    where: eq(dispatchOffers.id, args.offerId),
  });
  if (!offer) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'offer not found');
  if (offer.therapistUserId !== args.therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your offer');
  }
  if (offer.status !== 'pending') return offer;

  const [updated] = await ctx.db
    .update(dispatchOffers)
    .set({ status: 'declined', respondedAt: new Date(), note: args.reason })
    .where(eq(dispatchOffers.id, args.offerId))
    .returning();
  return updated!;
}

/** 技师查看自己待处理的派单 */
export async function listPendingForTherapist(
  ctx: DispatchContext,
  therapistUserId: string,
): Promise<DispatchOffer[]> {
  return ctx.db.query.dispatchOffers.findMany({
    where: and(
      eq(dispatchOffers.therapistUserId, therapistUserId),
      eq(dispatchOffers.status, 'pending'),
      gte(dispatchOffers.expiresAt, new Date()),
    ),
  });
}

/** cron 用：把过期 pending offer 标 expired */
export async function expireOldOffers(ctx: DispatchContext): Promise<number> {
  const rows = await ctx.db
    .update(dispatchOffers)
    .set({ status: 'expired' })
    .where(and(eq(dispatchOffers.status, 'pending'), isNull(dispatchOffers.respondedAt)))
    .returning({ id: dispatchOffers.id });
  return rows.length;
}
