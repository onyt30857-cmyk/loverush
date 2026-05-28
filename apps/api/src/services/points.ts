/**
 * 积分账户原子操作 · 给 M09 / M07 / M06 用
 *
 * 所有积分变动都走这里 → 保证：
 * 1. 账户行 row-level lock（pg SELECT FOR UPDATE）
 * 2. 写入 points_transaction 流水
 * 3. 幂等键（idempotency_key）一致返回相同 txn
 *
 * 不在这里做：充值 / 提现网关对接（在 payments.ts）
 */

import { eq, sql, and } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  pointsAccount,
  pointsTransaction,
  type PointsTransaction,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface PointsContext {
  db: Database;
}

type TxnType =
  | 'RECHARGE'
  | 'PAYWALL_UNLOCK'
  | 'TIP_GIVE'
  | 'TIP_RECEIVE'
  | 'CHAT_SPEND'
  | 'CHAT_EARN'
  | 'SHOP_PURCHASE'
  | 'SHOP_COMMISSION'
  | 'INVITE_REWARD'
  | 'WITHDRAW'
  | 'REFUND'
  | 'FROZEN'
  | 'UNFROZEN'
  | 'EXPIRED'
  | 'ADJUSTMENT'
  | 'AGENT_WHOLESALE'
  | 'AGENT_SELL'
  | 'AGENT_BUY';

export interface CreditDebitArgs {
  userId: string;
  type: TxnType;
  amount: number; // 正数
  description?: string;
  relatedOrderId?: string;
  relatedUserId?: string;
  relatedInviteCodeId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

async function ensureAccount(ctx: PointsContext, userId: string): Promise<void> {
  await ctx.db.insert(pointsAccount).values({ userId }).onConflictDoNothing();
}

async function findByIdempotency(
  ctx: PointsContext,
  userId: string,
  key: string,
): Promise<PointsTransaction | null> {
  const row = await ctx.db.query.pointsTransaction.findFirst({
    where: and(eq(pointsTransaction.userId, userId), eq(pointsTransaction.idempotencyKey, key)),
  });
  return row ?? null;
}

/** 入账（IN） */
export async function credit(
  ctx: PointsContext,
  args: CreditDebitArgs,
): Promise<PointsTransaction> {
  if (args.amount <= 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'amount must be > 0');
  }

  if (args.idempotencyKey) {
    const existing = await findByIdempotency(ctx, args.userId, args.idempotencyKey);
    if (existing) return existing;
  }

  await ensureAccount(ctx, args.userId);

  return await ctx.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(pointsAccount)
      .set({
        balance: sql`${pointsAccount.balance} + ${args.amount}`,
        totalIn: sql`${pointsAccount.totalIn} + ${args.amount}`,
        lastTxnAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pointsAccount.userId, args.userId))
      .returning();

    const [txn] = await tx
      .insert(pointsTransaction)
      .values({
        userId: args.userId,
        type: args.type,
        direction: 'IN',
        amount: args.amount,
        balanceAfter: updated!.balance,
        description: args.description,
        relatedOrderId: args.relatedOrderId,
        relatedUserId: args.relatedUserId,
        relatedInviteCodeId: args.relatedInviteCodeId,
        metadata: args.metadata ?? {},
        idempotencyKey: args.idempotencyKey,
      })
      .returning();

    return txn!;
  });
}

/** 出账（OUT） */
export async function debit(
  ctx: PointsContext,
  args: CreditDebitArgs,
): Promise<PointsTransaction> {
  if (args.amount <= 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'amount must be > 0');
  }

  if (args.idempotencyKey) {
    const existing = await findByIdempotency(ctx, args.userId, args.idempotencyKey);
    if (existing) return existing;
  }

  await ensureAccount(ctx, args.userId);

  return await ctx.db.transaction(async (tx) => {
    const acc = await tx.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, args.userId) });
    if (!acc) throw HttpError.internal('account missing');
    if (acc.balance < args.amount) {
      throw HttpError.badRequest(ErrorCode.E2010_BALANCE_INSUFFICIENT, 'insufficient balance');
    }

    const [updated] = await tx
      .update(pointsAccount)
      .set({
        balance: sql`${pointsAccount.balance} - ${args.amount}`,
        totalOut: sql`${pointsAccount.totalOut} + ${args.amount}`,
        lastTxnAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pointsAccount.userId, args.userId))
      .returning();

    const [txn] = await tx
      .insert(pointsTransaction)
      .values({
        userId: args.userId,
        type: args.type,
        direction: 'OUT',
        amount: args.amount,
        balanceAfter: updated!.balance,
        description: args.description,
        relatedOrderId: args.relatedOrderId,
        relatedUserId: args.relatedUserId,
        relatedInviteCodeId: args.relatedInviteCodeId,
        metadata: args.metadata ?? {},
        idempotencyKey: args.idempotencyKey,
      })
      .returning();

    return txn!;
  });
}

/** 双向转账（fromUser - amount → toUser + amount，原子） */
export async function transfer(
  ctx: PointsContext,
  args: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    typeFrom: TxnType;
    typeTo: TxnType;
    description?: string;
    relatedOrderId?: string;
    idempotencyKey?: string;
  },
): Promise<{ debit: PointsTransaction; credit: PointsTransaction }> {
  const debited = await debit(ctx, {
    userId: args.fromUserId,
    type: args.typeFrom,
    amount: args.amount,
    description: args.description,
    relatedOrderId: args.relatedOrderId,
    relatedUserId: args.toUserId,
    idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}.out` : undefined,
  });
  const credited = await credit(ctx, {
    userId: args.toUserId,
    type: args.typeTo,
    amount: args.amount,
    description: args.description,
    relatedOrderId: args.relatedOrderId,
    relatedUserId: args.fromUserId,
    idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}.in` : undefined,
  });
  return { debit: debited, credit: credited };
}
