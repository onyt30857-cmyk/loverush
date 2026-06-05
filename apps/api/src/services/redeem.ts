/**
 * M16 P1 · 积分回收 service · 平台冻结担保状态机
 *
 * created(发起·冻结) → agent_accepted(代理接单) → agent_paid(代理付款·凭证)
 *   → completed(持有人确认 / 24h 自动 · 积分释放给代理)
 * 旁路: cancelled(取消/拒绝·解冻退回) · expired(超时·解冻退回) · disputed(争议·仲裁)
 *
 * 资金（复用 deposits.ts 冻结范式，积分守恒）:
 *   发起   debit(FROZEN)         扣持有人 balance
 *   完成   credit(AGENT_REDEEM_IN) 给代理（持有人 FROZEN 即最终扣除，不退）
 *   取消/超时 credit(UNFROZEN)     退回持有人
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  pointRedeemOrders,
  agentProfiles,
  agentCustomerAssignment,
  pointsAccount,
  users,
  type PointRedeemOrder,
} from '@loverush/db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { credit, debit } from './points';

export interface RedeemContext {
  db: Database;
}

const AUTO_CONFIRM_HOURS = 24;
const CREATED_EXPIRE_DAYS = 7;

function badReq(msg: string): HttpError {
  return HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, msg);
}

async function requireOrder(ctx: RedeemContext, id: string): Promise<PointRedeemOrder> {
  const o = await ctx.db.query.pointRedeemOrders.findFirst({ where: eq(pointRedeemOrders.id, id) });
  if (!o) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'redeem order not found');
  return o;
}

/** 1 积分 = $0.01；回收价 = 面值 × 回收率 */
function computePayoutUsd(points: number, rateBps: number): string {
  return ((points * rateBps) / 10000 / 100).toFixed(2);
}

/** 持有人可回收的代理（绑定优先，否则任一开通回收的活跃代理）+ 回收率 + 余额 */
export async function getRedeemableAgent(
  ctx: RedeemContext,
  holderUserId: string,
): Promise<{ agentUserId: string; rateBps: number; balance: number } | null> {
  const assigned = await ctx.db.query.agentCustomerAssignment.findFirst({
    where: eq(agentCustomerAssignment.customerUserId, holderUserId),
  });
  let agent = assigned
    ? await ctx.db.query.agentProfiles.findFirst({ where: eq(agentProfiles.userId, assigned.agentUserId) })
    : null;
  if (!agent || !agent.redeemEnabled || agent.status !== 'active') {
    // 绑定代理不可回收 → 取任一开通回收的活跃代理（P1 简化）
    agent = await ctx.db.query.agentProfiles.findFirst({
      where: and(eq(agentProfiles.redeemEnabled, true), eq(agentProfiles.status, 'active')),
    });
  }
  if (!agent) return null;
  const acc = await ctx.db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, holderUserId) });
  return { agentUserId: agent.userId, rateBps: agent.redeemRateBps, balance: acc?.balance ?? 0 };
}

/** 发起回收 · 冻结持有人积分 */
export async function initiateRedeem(
  ctx: RedeemContext,
  args: {
    holderUserId: string;
    points: number;
    payoutMethodType: string;
    payoutMethodFields: Record<string, string>;
  },
): Promise<PointRedeemOrder> {
  if (args.points <= 0) throw badReq('invalid points');
  const info = await getRedeemableAgent(ctx, args.holderUserId);
  if (!info) throw badReq('暂无可回收的服务商');
  if (info.balance < args.points) {
    throw HttpError.badRequest(ErrorCode.E2010_BALANCE_INSUFFICIENT, '可用积分不足');
  }

  const payoutAmount = computePayoutUsd(args.points, info.rateBps);
  const [order] = await ctx.db
    .insert(pointRedeemOrders)
    .values({
      holderUserId: args.holderUserId,
      agentUserId: info.agentUserId,
      points: args.points,
      rateBps: info.rateBps,
      payoutAmount,
      payoutCurrency: 'USD',
      payoutMethodType: args.payoutMethodType,
      payoutMethodFields: args.payoutMethodFields,
      status: 'created',
    })
    .returning();

  // 冻结（debit FROZEN）；失败补偿删单，避免脏的 created 单
  try {
    const frozen = await debit(ctx, {
      userId: args.holderUserId,
      type: 'FROZEN',
      amount: args.points,
      description: `积分回收冻结 · 单 ${order!.id.slice(0, 8)}`,
      relatedUserId: info.agentUserId,
      metadata: { redeemOrderId: order!.id, reason: 'redeem_freeze' },
      idempotencyKey: `redeem.freeze.${order!.id}`,
    });
    await ctx.db
      .update(pointRedeemOrders)
      .set({ frozenTxnId: frozen.id })
      .where(eq(pointRedeemOrders.id, order!.id));
    return { ...order!, frozenTxnId: frozen.id };
  } catch (e) {
    await ctx.db.delete(pointRedeemOrders).where(eq(pointRedeemOrders.id, order!.id));
    throw e;
  }
}

/** 代理接单 */
export async function agentAcceptRedeem(
  ctx: RedeemContext,
  args: { agentUserId: string; redeemId: string },
): Promise<void> {
  const o = await requireOrder(ctx, args.redeemId);
  if (o.agentUserId !== args.agentUserId) throw badReq('not your order');
  if (o.status !== 'created') throw badReq(`不可接单(当前 ${o.status})`);
  await ctx.db
    .update(pointRedeemOrders)
    .set({ status: 'agent_accepted', agentAcceptedAt: new Date() })
    .where(eq(pointRedeemOrders.id, args.redeemId));
}

/** 代理标记已付款 + 凭证 */
export async function agentMarkPaid(
  ctx: RedeemContext,
  args: { agentUserId: string; redeemId: string; proofUrl?: string },
): Promise<void> {
  const o = await requireOrder(ctx, args.redeemId);
  if (o.agentUserId !== args.agentUserId) throw badReq('not your order');
  if (o.status !== 'agent_accepted' && o.status !== 'created') {
    throw badReq(`不可标付(当前 ${o.status})`);
  }
  await ctx.db
    .update(pointRedeemOrders)
    .set({ status: 'agent_paid', agentPaidAt: new Date(), agentPaidProofUrl: args.proofUrl ?? null })
    .where(eq(pointRedeemOrders.id, args.redeemId));
}

/** 内部 · 积分释放给代理 + 状态 completed + 代理累计统计 */
async function settleToAgent(ctx: RedeemContext, o: PointRedeemOrder): Promise<void> {
  const credited = await credit(ctx, {
    userId: o.agentUserId,
    type: 'AGENT_REDEEM_IN',
    amount: o.points,
    description: `回收积分入库 · 单 ${o.id.slice(0, 8)}`,
    relatedUserId: o.holderUserId,
    metadata: { redeemOrderId: o.id },
    idempotencyKey: `redeem.settle.${o.id}`,
  });
  await ctx.db
    .update(pointRedeemOrders)
    .set({ status: 'completed', completedAt: new Date(), transferTxnId: credited.id })
    .where(eq(pointRedeemOrders.id, o.id));
  await ctx.db
    .update(agentProfiles)
    .set({ totalRedeemedPoints: sql`${agentProfiles.totalRedeemedPoints} + ${o.points}` })
    .where(eq(agentProfiles.userId, o.agentUserId));
}

/** 内部 · 解冻退回持有人 */
async function refundToHolder(
  ctx: RedeemContext,
  o: PointRedeemOrder,
  finalStatus: 'cancelled' | 'expired',
): Promise<void> {
  await credit(ctx, {
    userId: o.holderUserId,
    type: 'UNFROZEN',
    amount: o.points,
    description: `回收${finalStatus === 'expired' ? '超时' : '取消'}解冻 · 单 ${o.id.slice(0, 8)}`,
    metadata: { redeemOrderId: o.id, reason: `redeem_${finalStatus}` },
    idempotencyKey: `redeem.refund.${o.id}`,
  });
  await ctx.db
    .update(pointRedeemOrders)
    .set({ status: finalStatus })
    .where(eq(pointRedeemOrders.id, o.id));
}

/** 持有人确认到账 → 释放给代理（终态） */
export async function holderConfirmRedeem(
  ctx: RedeemContext,
  args: { holderUserId: string; redeemId: string },
): Promise<void> {
  const o = await requireOrder(ctx, args.redeemId);
  if (o.holderUserId !== args.holderUserId) throw badReq('not your order');
  if (o.status !== 'agent_paid') throw badReq(`不可确认(当前 ${o.status})`);
  await settleToAgent(ctx, o);
}

/** 取消 / 代理拒绝 → 解冻退回（付款前才可，付款后须走争议） */
export async function cancelRedeem(
  ctx: RedeemContext,
  args: { redeemId: string; actorUserId: string },
): Promise<void> {
  const o = await requireOrder(ctx, args.redeemId);
  if (o.holderUserId !== args.actorUserId && o.agentUserId !== args.actorUserId) {
    throw badReq('not your order');
  }
  if (['completed', 'cancelled', 'expired'].includes(o.status)) return; // 幂等
  if (o.status === 'agent_paid') throw badReq('代理已付款，不能直接取消，请发起争议');
  await refundToHolder(ctx, o, 'cancelled');
}

/** 发起争议（已付款单：持有人说没收到 / 代理纠纷） */
export async function openRedeemDispute(
  ctx: RedeemContext,
  args: { userId: string; redeemId: string },
): Promise<void> {
  const o = await requireOrder(ctx, args.redeemId);
  if (o.holderUserId !== args.userId && o.agentUserId !== args.userId) throw badReq('not your order');
  if (o.status !== 'agent_paid') throw badReq(`仅已付款单可争议(当前 ${o.status})`);
  await ctx.db
    .update(pointRedeemOrders)
    .set({ status: 'disputed', disputeStatus: 'open' })
    .where(eq(pointRedeemOrders.id, args.redeemId));
}

/** 24h 自动确认 cron · agent_paid 超时 → completed */
export async function autoConfirmPaidRedeems(ctx: RedeemContext): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_CONFIRM_HOURS * 3600_000);
  const rows = await ctx.db.query.pointRedeemOrders.findMany({
    where: and(eq(pointRedeemOrders.status, 'agent_paid'), lt(pointRedeemOrders.agentPaidAt, cutoff)),
    limit: 200,
  });
  for (const o of rows) await settleToAgent(ctx, o);
  return rows.length;
}

/** created/agent_accepted 超时（7天无人付款）→ 解冻退回 */
export async function expireStaleRedeems(ctx: RedeemContext): Promise<number> {
  const cutoff = new Date(Date.now() - CREATED_EXPIRE_DAYS * 86400_000);
  const rows = await ctx.db.query.pointRedeemOrders.findMany({
    where: and(
      inArray(pointRedeemOrders.status, ['created', 'agent_accepted']),
      lt(pointRedeemOrders.createdAt, cutoff),
    ),
    limit: 200,
  });
  for (const o of rows) await refundToHolder(ctx, o, 'expired');
  return rows.length;
}

export async function listHolderRedeems(ctx: RedeemContext, holderUserId: string): Promise<PointRedeemOrder[]> {
  return ctx.db.query.pointRedeemOrders.findMany({
    where: eq(pointRedeemOrders.holderUserId, holderUserId),
    orderBy: [desc(pointRedeemOrders.createdAt)],
    limit: 50,
  });
}

export async function listAgentRedeems(
  ctx: RedeemContext,
  agentUserId: string,
  status?: PointRedeemOrder['status'],
): Promise<PointRedeemOrder[]> {
  return ctx.db.query.pointRedeemOrders.findMany({
    where: status
      ? and(eq(pointRedeemOrders.agentUserId, agentUserId), eq(pointRedeemOrders.status, status))
      : eq(pointRedeemOrders.agentUserId, agentUserId),
    orderBy: [desc(pointRedeemOrders.createdAt)],
    limit: 50,
  });
}

export interface AdminRedeemRow extends PointRedeemOrder {
  holderName: string | null;
  agentName: string | null;
}

/** Admin · 列出回收单（默认争议中），联查双方姓名 */
export async function listAdminRedeems(
  ctx: RedeemContext,
  args: { status?: PointRedeemOrder['status']; limit?: number } = {},
): Promise<AdminRedeemRow[]> {
  const limit = args.limit ?? 50;
  const rows = await ctx.db.query.pointRedeemOrders.findMany({
    where: args.status ? eq(pointRedeemOrders.status, args.status) : undefined,
    orderBy: [desc(pointRedeemOrders.createdAt)],
    limit,
  });
  if (rows.length === 0) return [];
  const uids = Array.from(new Set([...rows.map((r) => r.holderUserId), ...rows.map((r) => r.agentUserId)]));
  const userList = await ctx.db.query.users.findMany({ where: inArray(users.id, uids) });
  const nameMap = new Map(userList.map((u) => [u.id, u.displayName]));
  return rows.map((r) => ({
    ...r,
    holderName: nameMap.get(r.holderUserId) ?? null,
    agentName: nameMap.get(r.agentUserId) ?? null,
  }));
}

/** Admin 仲裁争议单 · 释放给代理 或 解冻退回持有人 */
export async function adminResolveRedeem(
  ctx: RedeemContext,
  args: { redeemId: string; resolution: 'release_to_agent' | 'refund_holder' },
): Promise<void> {
  const o = await requireOrder(ctx, args.redeemId);
  if (o.status !== 'disputed') throw badReq(`仅争议单可仲裁(当前 ${o.status})`);
  if (args.resolution === 'release_to_agent') await settleToAgent(ctx, o);
  else await refundToHolder(ctx, o, 'cancelled');
  await ctx.db
    .update(pointRedeemOrders)
    .set({ disputeStatus: 'resolved' })
    .where(eq(pointRedeemOrders.id, args.redeemId));
}
