/**
 * M16 · 积分代理分销 服务
 *
 * 站内 1 积分 = $0.01；代理批发 USD 面值 = 积分 × $0.01（= 积分 cents），USDT 付 = 面值 × 0.9。
 * 平台不碰客户↔代理的法币；代理→客户用 transfer() 原子转积分，购买单留凭证可仲裁。
 *
 * 详见 v1/modules/M16-积分代理分销.md
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  agentProfiles,
  agentPaymentMethods,
  agentCustomerAssignment,
  agentWholesaleOrders,
  pointPurchaseOrders,
  type AgentProfile,
  type AgentPaymentMethod,
  type AgentWholesaleOrder,
  type PointPurchaseOrder,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { credit, transfer, type PointsContext } from './points';
import { grant, type RoleContext } from './roles';

export interface AgentContext {
  db: Database;
}

export const WHOLESALE_RATE = 0.9; // 代理 9 折

// ════════════ 平台 → 代理：授予 + 批发 ════════════

export async function grantAgent(
  ctx: AgentContext,
  args: { userId: string; serviceCountries: string[]; serviceCities?: string[]; grantedByUserId?: string },
): Promise<AgentProfile> {
  await grant(ctx, { userId: args.userId, role: 'agent', grantedByUserId: args.grantedByUserId });
  const [row] = await ctx.db
    .insert(agentProfiles)
    .values({
      userId: args.userId,
      serviceCountries: args.serviceCountries,
      serviceCities: args.serviceCities ?? [],
    })
    .onConflictDoUpdate({
      target: agentProfiles.userId,
      set: { serviceCountries: args.serviceCountries, serviceCities: args.serviceCities ?? [], updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function getAgentProfile(ctx: AgentContext, userId: string): Promise<AgentProfile | null> {
  const row = await ctx.db.query.agentProfiles.findFirst({ where: eq(agentProfiles.userId, userId) });
  return row ?? null;
}

export async function createWholesaleOrder(
  ctx: AgentContext,
  args: { agentUserId: string; points: number },
): Promise<AgentWholesaleOrder> {
  if (!Number.isInteger(args.points) || args.points <= 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'points must be a positive integer');
  }
  const usdFaceCents = args.points; // 1 积分 = 1 cent
  const usdtAmountCents = Math.round(args.points * WHOLESALE_RATE);
  const [row] = await ctx.db
    .insert(agentWholesaleOrders)
    .values({ agentUserId: args.agentUserId, points: args.points, usdFaceCents, usdtAmountCents })
    .returning();
  return row!;
}

export async function listWholesaleOrders(ctx: AgentContext, agentUserId: string): Promise<AgentWholesaleOrder[]> {
  return ctx.db.query.agentWholesaleOrders.findMany({
    where: eq(agentWholesaleOrders.agentUserId, agentUserId),
    orderBy: [desc(agentWholesaleOrders.createdAt)],
  });
}

/** admin 确认 USDT 到账 → 给代理入账积分（幂等） */
export async function confirmWholesaleOrder(
  ctx: AgentContext,
  args: { orderId: string; adminUserId: string; usdtTxnRef: string },
): Promise<AgentWholesaleOrder> {
  const order = await ctx.db.query.agentWholesaleOrders.findFirst({
    where: eq(agentWholesaleOrders.id, args.orderId),
  });
  if (!order) throw HttpError.notFound();
  if (order.status !== 'pending') {
    throw HttpError.conflict(ErrorCode.E0002_IDEMPOTENCY_CONFLICT, `wholesale order already ${order.status}`);
  }
  const txn = await credit(ctx, {
    userId: order.agentUserId,
    type: 'AGENT_WHOLESALE',
    amount: order.points,
    description: `代理批发入账 ${order.points} 积分`,
    idempotencyKey: `wholesale_${order.id}`,
    metadata: { wholesaleOrderId: order.id, usdtTxnRef: args.usdtTxnRef },
  });
  const [updated] = await ctx.db
    .update(agentWholesaleOrders)
    .set({
      status: 'confirmed',
      confirmedBy: args.adminUserId,
      confirmedAt: new Date(),
      usdtTxnRef: args.usdtTxnRef,
      pointsTxnId: txn.id,
    })
    .where(eq(agentWholesaleOrders.id, args.orderId))
    .returning();
  await ctx.db
    .update(agentProfiles)
    .set({ totalWholesalePoints: sql`${agentProfiles.totalWholesalePoints} + ${order.points}`, updatedAt: new Date() })
    .where(eq(agentProfiles.userId, order.agentUserId));
  return updated!;
}

// ════════════ 代理收款方式 ════════════

export async function listPaymentMethods(ctx: AgentContext, agentUserId: string): Promise<AgentPaymentMethod[]> {
  return ctx.db.query.agentPaymentMethods.findMany({
    where: eq(agentPaymentMethods.agentUserId, agentUserId),
    orderBy: [desc(agentPaymentMethods.createdAt)],
  });
}

export async function upsertPaymentMethod(
  ctx: AgentContext,
  args: {
    id?: string;
    agentUserId: string;
    country: string;
    methodType: 'bank' | 'alipay' | 'wechat';
    fields: Record<string, string>;
    minPurchasePoints?: number;
    isActive?: boolean;
  },
): Promise<AgentPaymentMethod> {
  if (args.id) {
    const [row] = await ctx.db
      .update(agentPaymentMethods)
      .set({
        country: args.country,
        methodType: args.methodType,
        fields: args.fields,
        minPurchasePoints: args.minPurchasePoints ?? 0,
        isActive: args.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(and(eq(agentPaymentMethods.id, args.id), eq(agentPaymentMethods.agentUserId, args.agentUserId)))
      .returning();
    if (!row) throw HttpError.notFound();
    return row;
  }
  const [row] = await ctx.db
    .insert(agentPaymentMethods)
    .values({
      agentUserId: args.agentUserId,
      country: args.country,
      methodType: args.methodType,
      fields: args.fields,
      minPurchasePoints: args.minPurchasePoints ?? 0,
      isActive: args.isActive ?? true,
    })
    .returning();
  return row!;
}

export async function deletePaymentMethod(ctx: AgentContext, args: { agentUserId: string; id: string }): Promise<void> {
  await ctx.db
    .delete(agentPaymentMethods)
    .where(and(eq(agentPaymentMethods.id, args.id), eq(agentPaymentMethods.agentUserId, args.agentUserId)));
}

// ════════════ 客户绑定代理（按国家自动分配） ════════════

async function findActiveAgentForCountry(ctx: AgentContext, country?: string): Promise<AgentProfile | null> {
  const rows = await ctx.db.query.agentProfiles.findMany({ where: eq(agentProfiles.status, 'active') });
  if (rows.length === 0) return null;
  if (country) {
    const match = rows.find((a) => Array.isArray(a.serviceCountries) && a.serviceCountries.includes(country));
    if (match) return match;
  }
  return rows[0]!; // 兜底：无国家匹配时给第一个 active 代理
}

export async function getOrAssignAgent(
  ctx: AgentContext,
  args: { customerUserId: string; country?: string },
): Promise<{ agentUserId: string } | null> {
  const existing = await ctx.db.query.agentCustomerAssignment.findFirst({
    where: eq(agentCustomerAssignment.customerUserId, args.customerUserId),
  });
  if (existing) return { agentUserId: existing.agentUserId };
  const agent = await findActiveAgentForCountry(ctx, args.country);
  if (!agent) return null;
  await ctx.db
    .insert(agentCustomerAssignment)
    .values({ customerUserId: args.customerUserId, agentUserId: agent.userId, country: args.country, assignedBy: 'auto' })
    .onConflictDoNothing();
  return { agentUserId: agent.userId };
}

/** 客户视角：我的代理 + 其收款方式（按客户国家过滤，无则返回全部 active） */
export async function getMyAgentForCustomer(
  ctx: AgentContext,
  args: { customerUserId: string; country?: string },
): Promise<{ agentUserId: string; paymentMethods: AgentPaymentMethod[] } | null> {
  const assigned = await getOrAssignAgent(ctx, args);
  if (!assigned) return null;
  const all = await ctx.db.query.agentPaymentMethods.findMany({
    where: and(eq(agentPaymentMethods.agentUserId, assigned.agentUserId), eq(agentPaymentMethods.isActive, true)),
  });
  const filtered = args.country ? all.filter((m) => m.country === args.country) : all;
  return { agentUserId: assigned.agentUserId, paymentMethods: filtered.length > 0 ? filtered : all };
}

// ════════════ 客户购买单（核心闭环） ════════════

export async function createPurchaseOrder(
  ctx: AgentContext,
  args: { customerUserId: string; points: number; paymentMethodId: string; country?: string; localAmount?: string; localCurrency?: string },
): Promise<PointPurchaseOrder> {
  if (!Number.isInteger(args.points) || args.points <= 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'points must be a positive integer');
  }
  const assigned = await getOrAssignAgent(ctx, { customerUserId: args.customerUserId, country: args.country });
  if (!assigned) throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '暂无可用积分服务商');
  const pm = await ctx.db.query.agentPaymentMethods.findFirst({
    where: and(
      eq(agentPaymentMethods.id, args.paymentMethodId),
      eq(agentPaymentMethods.agentUserId, assigned.agentUserId),
      eq(agentPaymentMethods.isActive, true),
    ),
  });
  if (!pm) throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'invalid payment method');
  if (args.points < pm.minPurchasePoints) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `低于最小购买量 ${pm.minPurchasePoints} 积分`);
  }
  const [row] = await ctx.db
    .insert(pointPurchaseOrders)
    .values({
      customerUserId: args.customerUserId,
      agentUserId: assigned.agentUserId,
      points: args.points,
      paymentMethodId: pm.id,
      localAmount: args.localAmount,
      localCurrency: args.localCurrency,
      methodSnapshot: { methodType: pm.methodType, fields: pm.fields, country: pm.country },
    })
    .returning();
  return row!;
}

export async function markPurchasePaid(
  ctx: AgentContext,
  args: { customerUserId: string; orderId: string; proofUrl?: string },
): Promise<PointPurchaseOrder> {
  const order = await ctx.db.query.pointPurchaseOrders.findFirst({
    where: eq(pointPurchaseOrders.id, args.orderId),
  });
  if (!order || order.customerUserId !== args.customerUserId) throw HttpError.notFound();
  if (order.status !== 'created') {
    throw HttpError.conflict(ErrorCode.E0002_IDEMPOTENCY_CONFLICT, `order already ${order.status}`);
  }
  const [row] = await ctx.db
    .update(pointPurchaseOrders)
    .set({ status: 'customer_paid', customerPaidAt: new Date(), customerPaidProofUrl: args.proofUrl })
    .where(eq(pointPurchaseOrders.id, args.orderId))
    .returning();
  return row!;
}

/** 代理确认收款 → 原子转积分给客户（幂等，余额不足由 transfer/debit 抛错） */
export async function confirmPurchaseAndTransfer(
  ctx: AgentContext,
  args: { agentUserId: string; orderId: string },
): Promise<PointPurchaseOrder> {
  const order = await ctx.db.query.pointPurchaseOrders.findFirst({
    where: eq(pointPurchaseOrders.id, args.orderId),
  });
  if (!order || order.agentUserId !== args.agentUserId) throw HttpError.notFound();
  if (order.status !== 'customer_paid') {
    throw HttpError.conflict(ErrorCode.E0002_IDEMPOTENCY_CONFLICT, `order status is ${order.status}, expected customer_paid`);
  }
  const { credit: cr } = await transfer(ctx, {
    fromUserId: args.agentUserId,
    toUserId: order.customerUserId,
    amount: order.points,
    typeFrom: 'AGENT_SELL',
    typeTo: 'AGENT_BUY',
    description: `积分售卖 ${order.points} 积分`,
    idempotencyKey: `purchase_${order.id}`,
  });
  const [row] = await ctx.db
    .update(pointPurchaseOrders)
    .set({ status: 'points_sent', agentConfirmedAt: new Date(), pointsSentAt: new Date(), transferTxnId: cr.id })
    .where(eq(pointPurchaseOrders.id, args.orderId))
    .returning();
  await ctx.db
    .update(agentProfiles)
    .set({ totalSoldPoints: sql`${agentProfiles.totalSoldPoints} + ${order.points}`, updatedAt: new Date() })
    .where(eq(agentProfiles.userId, args.agentUserId));
  return row!;
}

export async function listMyPurchaseOrders(ctx: AgentContext, customerUserId: string): Promise<PointPurchaseOrder[]> {
  return ctx.db.query.pointPurchaseOrders.findMany({
    where: eq(pointPurchaseOrders.customerUserId, customerUserId),
    orderBy: [desc(pointPurchaseOrders.createdAt)],
  });
}

export async function listAgentPurchaseOrders(
  ctx: AgentContext,
  args: { agentUserId: string; status?: PointPurchaseOrder['status'] },
): Promise<PointPurchaseOrder[]> {
  return ctx.db.query.pointPurchaseOrders.findMany({
    where: args.status
      ? and(eq(pointPurchaseOrders.agentUserId, args.agentUserId), eq(pointPurchaseOrders.status, args.status))
      : eq(pointPurchaseOrders.agentUserId, args.agentUserId),
    orderBy: [desc(pointPurchaseOrders.createdAt)],
  });
}

// ════════════ admin ════════════

export async function listAgents(ctx: AgentContext): Promise<AgentProfile[]> {
  return ctx.db.query.agentProfiles.findMany({ orderBy: [desc(agentProfiles.createdAt)] });
}

export async function listAllWholesaleOrders(
  ctx: AgentContext,
  args: { status?: AgentWholesaleOrder['status'] },
): Promise<AgentWholesaleOrder[]> {
  return ctx.db.query.agentWholesaleOrders.findMany({
    where: args.status ? eq(agentWholesaleOrders.status, args.status) : undefined,
    orderBy: [desc(agentWholesaleOrders.createdAt)],
    limit: 200,
  });
}
