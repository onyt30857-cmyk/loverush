/**
 * 订单服务 · M07 凭证链与服务记录
 *
 * 11 状态机：
 *   DRAFT → PENDING_CONFIRM → LOCKED → PAID → IN_SERVICE → COMPLETED → REVIEWED
 *   异常路径：CANCELLED / DISPUTED → REFUNDED / CLOSED
 *
 * 每次状态转移自动 append chain event（哈希链）+ 状态切换。
 */

import { eq, sql, inArray, desc, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  Database} from '@loverush/db';
import {
  orders,
  therapists,
  users,
  type Order,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { appendChainEvent, computePriceLockHash } from './chain';

// ──────────────── 合法状态转移 ────────────────

type OrderStatus = Order['status'];

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING_CONFIRM', 'CANCELLED'],
  PENDING_CONFIRM: ['LOCKED', 'CANCELLED'],
  LOCKED: ['PAID', 'CANCELLED'],
  PAID: ['IN_SERVICE', 'CANCELLED', 'DISPUTED'],
  IN_SERVICE: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['REVIEWED', 'DISPUTED'],
  REVIEWED: ['DISPUTED', 'CLOSED'],
  DISPUTED: ['REFUNDED', 'COMPLETED', 'CLOSED'],
  CANCELLED: ['CLOSED'],
  REFUNDED: ['CLOSED'],
  CLOSED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

function assertCanTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) {
    throw HttpError.conflict(
      ErrorCode.E3050_ORDER_STATE_ILLEGAL,
      `illegal transition ${from} -> ${to}`,
    );
  }
}

// ──────────────── 业务接口 ────────────────

export interface ServiceSnapshot {
  skills: string[];
  durationMin: number;
  pricePoints: number;
  itemsBreakdown?: Array<{ name: string; pricePoints: number }>;
}

export interface CreateOrderParams {
  customerId: string;
  therapistId: string;
  serviceSnapshot: ServiceSnapshot;
  scheduledAt?: Date;
}

export interface OrderContext {
  db: Database;
}

function generateOrderNo(): string {
  const d = new Date();
  const yyyymmdd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `LR${yyyymmdd}${nanoid(8).toUpperCase()}`;
}

export async function createOrder(ctx: OrderContext, p: CreateOrderParams): Promise<Order> {
  const therapist = await ctx.db.query.therapists.findFirst({
    where: eq(therapists.id, p.therapistId),
  });
  if (!therapist) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  }

  const [order] = await ctx.db
    .insert(orders)
    .values({
      orderNo: generateOrderNo(),
      customerId: p.customerId,
      therapistId: therapist.id,
      therapistUserId: therapist.userId,
      status: 'DRAFT',
      serviceSnapshot: p.serviceSnapshot,
      pricePoints: p.serviceSnapshot.pricePoints,
      scheduledAt: p.scheduledAt,
    })
    .returning();

  if (!order) throw HttpError.internal('order create failed');

  await appendChainEvent(ctx.db, {
    orderId: order.id,
    event: 'order_created',
    payload: {
      orderNo: order.orderNo,
      customerId: p.customerId,
      therapistId: therapist.id,
      pricePoints: p.serviceSnapshot.pricePoints,
      serviceSnapshot: p.serviceSnapshot,
    },
    actorUserId: p.customerId,
    actorRole: 'customer',
  });

  return order;
}

async function transition(
  ctx: OrderContext,
  orderId: string,
  to: OrderStatus,
  chain: {
    event: Parameters<typeof appendChainEvent>[1]['event'];
    payload: Record<string, unknown>;
    actorUserId?: string;
    actorRole?: 'customer' | 'therapist' | 'system' | 'admin';
  },
  patch?: Partial<Order>,
): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');

  assertCanTransition(current.status, to);

  const updates: Partial<Order> = { status: to, updatedAt: new Date(), ...patch };

  const [updated] = await ctx.db
    .update(orders)
    .set(updates as Record<string, unknown>)
    .where(eq(orders.id, orderId))
    .returning();

  if (!updated) throw HttpError.internal('order update failed');

  await appendChainEvent(ctx.db, { orderId, ...chain });
  return updated;
}

/** 客户提交订单 → 待技师确认 */
export async function submitOrder(ctx: OrderContext, orderId: string, customerId: string) {
  return transition(
    ctx,
    orderId,
    'PENDING_CONFIRM',
    { event: 'order_created', payload: { submittedBy: customerId }, actorUserId: customerId, actorRole: 'customer' },
  );
}

/** 技师确认 + 锁价 */
export async function confirmAndLock(ctx: OrderContext, orderId: string, therapistUserId: string): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (current.therapistUserId !== therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your order');
  }

  const lockedAt = new Date();
  const priceLockHash = await computePriceLockHash({
    orderId: current.id,
    pricePoints: current.pricePoints,
    serviceSnapshot: current.serviceSnapshot,
    lockedAt,
  });

  return transition(
    ctx,
    orderId,
    'LOCKED',
    {
      event: 'price_locked',
      payload: {
        pricePoints: current.pricePoints,
        serviceSnapshot: current.serviceSnapshot,
        lockedAt: lockedAt.toISOString(),
        priceLockHash,
      },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { priceLockedAt: lockedAt, priceLockHash },
  );
}

/** 客户支付完成 */
export async function markPaid(
  ctx: OrderContext,
  orderId: string,
  paymentTxnId: string,
  customerId: string,
): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'PAID',
    {
      event: 'payment_received',
      payload: { paymentTxnId, paidAt: new Date().toISOString() },
      actorUserId: customerId,
      actorRole: 'customer',
    },
    { paidAt: new Date(), paymentTxnId },
  );
}

/** 技师开始服务 */
export async function startService(ctx: OrderContext, orderId: string, therapistUserId: string): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'IN_SERVICE',
    {
      event: 'service_started',
      payload: { startedAt: new Date().toISOString() },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { startedAt: new Date() },
  );
}

/** 技师标记完成 */
export async function completeService(ctx: OrderContext, orderId: string, therapistUserId: string): Promise<Order> {
  const completedAt = new Date();
  return transition(
    ctx,
    orderId,
    'COMPLETED',
    {
      event: 'service_completed',
      payload: { completedAt: completedAt.toISOString() },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { completedAt },
  );
}

/** 客户评价 → 进入 REVIEWED */
export async function reviewOrder(
  ctx: OrderContext,
  orderId: string,
  customerId: string,
  payload: { rating: number; review?: string },
): Promise<Order> {
  if (payload.rating < 1 || payload.rating > 5) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'rating must be 1-5');
  }
  return transition(
    ctx,
    orderId,
    'REVIEWED',
    {
      event: 'review_submitted',
      payload: { rating: payload.rating, review: payload.review ?? null },
      actorUserId: customerId,
      actorRole: 'customer',
    },
    {
      reviewedAt: new Date(),
      customerRating: payload.rating,
      customerReview: payload.review,
    },
  );
}

/** 取消订单（任意可取消阶段） */
export async function cancelOrder(
  ctx: OrderContext,
  orderId: string,
  actorUserId: string,
  reason: string,
  actorRole: 'customer' | 'therapist' | 'admin' = 'customer',
): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'CANCELLED',
    {
      event: 'order_created',
      payload: { cancelReason: reason, cancelledBy: actorRole },
      actorUserId,
      actorRole,
    },
  );
}

/** 提起争议 */
export async function raiseDispute(
  ctx: OrderContext,
  orderId: string,
  actorUserId: string,
  reason: string,
  actorRole: 'customer' | 'therapist' = 'customer',
): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'DISPUTED',
    {
      event: 'dispute_raised',
      payload: { reason, raisedBy: actorRole },
      actorUserId,
      actorRole,
    },
    { disputeOpenedAt: new Date(), disputeReason: reason },
  );
}

/** 仲裁退款 */
export async function resolveDispute(
  ctx: OrderContext,
  orderId: string,
  adminUserId: string,
  outcome: { resolution: 'refund' | 'reject'; refundPoints?: number; note?: string },
): Promise<Order> {
  if (outcome.resolution === 'refund') {
    const refundPoints = outcome.refundPoints ?? 0;
    const o = await transition(
      ctx,
      orderId,
      'REFUNDED',
      {
        event: 'dispute_resolved',
        payload: { resolution: 'refund', refundPoints, note: outcome.note },
        actorUserId: adminUserId,
        actorRole: 'admin',
      },
      { refundedAt: new Date(), refundPoints },
    );
    return o;
  }
  return transition(
    ctx,
    orderId,
    'COMPLETED',
    {
      event: 'dispute_resolved',
      payload: { resolution: 'reject', note: outcome.note },
      actorUserId: adminUserId,
      actorRole: 'admin',
    },
  );
}

/** 增加技师完成单数（外部统计调用） */
export interface ListOrdersParams {
  userId: string;
  role: 'customer' | 'therapist';
  status?: OrderStatus | OrderStatus[];
  limit?: number;
  offset?: number;
}

export async function listOrders(ctx: OrderContext, p: ListOrdersParams): Promise<Order[]> {
  const limit = Math.min(Math.max(p.limit ?? 30, 1), 100);
  const offset = Math.max(p.offset ?? 0, 0);

  const conditions = [
    p.role === 'customer'
      ? eq(orders.customerId, p.userId)
      : eq(orders.therapistUserId, p.userId),
  ];

  if (p.status) {
    const statuses = Array.isArray(p.status) ? p.status : [p.status];
    if (statuses.length === 1) {
      conditions.push(eq(orders.status, statuses[0]!));
    } else if (statuses.length > 1) {
      conditions.push(sql`${orders.status} = ANY(${statuses})`);
    }
  }

  const rows = await ctx.db.query.orders.findMany({
    where: (_t, { and }) => (conditions.length > 1 ? and(...conditions) : conditions[0]),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
    offset,
  });

  return rows;
}

export async function bumpTherapistStats(ctx: OrderContext, therapistId: string) {
  await ctx.db
    .update(therapists)
    .set({ completedOrders: sql`${therapists.completedOrders} + 1` })
    .where(eq(therapists.id, therapistId));
}

// ──────────────── admin 列表/详情(运营总监看订单大盘) ────────────────

export interface AdminOrderRow {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string | null;
  therapistUserId: string;
  therapistName: string | null;
  status: OrderStatus;
  pricePoints: number;
  durationMin: number;
  disputeOpenedAt: Date | null;
  disputeReason: string | null;
  refundPoints: number | null;
  createdAt: Date;
}

export async function adminListOrders(
  ctx: OrderContext,
  p: {
    status?: OrderStatus;
    search?: string; // 模糊查 order_no
    customerId?: string;
    therapistUserId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<AdminOrderRow[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const offset = Math.max(p.offset ?? 0, 0);

  const conditions = [];
  if (p.status) conditions.push(eq(orders.status, p.status));
  if (p.search) conditions.push(sql`${orders.orderNo} ILIKE ${'%' + p.search + '%'}`);
  if (p.customerId) conditions.push(eq(orders.customerId, p.customerId));
  if (p.therapistUserId) conditions.push(eq(orders.therapistUserId, p.therapistUserId));

  const rows = await ctx.db.query.orders.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(orders.createdAt)],
    limit,
    offset,
  });

  // 联查 customer/therapist 昵称
  const userIds = Array.from(new Set([...rows.map((r) => r.customerId), ...rows.map((r) => r.therapistUserId)]));
  const userList = userIds.length > 0
    ? await ctx.db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];
  const nameMap = new Map(userList.map((u) => [u.id, u.displayName]));

  return rows.map((r) => ({
    id: r.id,
    orderNo: r.orderNo,
    customerId: r.customerId,
    customerName: nameMap.get(r.customerId) ?? null,
    therapistUserId: r.therapistUserId,
    therapistName: nameMap.get(r.therapistUserId) ?? null,
    status: r.status,
    pricePoints: r.pricePoints,
    durationMin: r.serviceSnapshot?.durationMin ?? 0,
    disputeOpenedAt: r.disputeOpenedAt,
    disputeReason: r.disputeReason,
    refundPoints: r.refundPoints,
    createdAt: r.createdAt,
  }));
}

export async function adminGetOrder(ctx: OrderContext, orderId: string): Promise<AdminOrderRow & { serviceSkills: string[]; paidAt: Date | null; completedAt: Date | null } | null> {
  const r = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!r) return null;
  const userIds = [r.customerId, r.therapistUserId];
  const userList = await ctx.db.query.users.findMany({ where: inArray(users.id, userIds) });
  const nameMap = new Map(userList.map((u) => [u.id, u.displayName]));
  return {
    id: r.id,
    orderNo: r.orderNo,
    customerId: r.customerId,
    customerName: nameMap.get(r.customerId) ?? null,
    therapistUserId: r.therapistUserId,
    therapistName: nameMap.get(r.therapistUserId) ?? null,
    status: r.status,
    pricePoints: r.pricePoints,
    durationMin: r.serviceSnapshot?.durationMin ?? 0,
    disputeOpenedAt: r.disputeOpenedAt,
    disputeReason: r.disputeReason,
    refundPoints: r.refundPoints,
    createdAt: r.createdAt,
    serviceSkills: r.serviceSnapshot?.skills ?? [],
    paidAt: r.paidAt,
    completedAt: r.completedAt,
  };
}
