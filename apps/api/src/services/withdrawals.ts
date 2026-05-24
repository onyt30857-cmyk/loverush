/**
 * 提现 · M09c
 *
 * 技师提交提现申请 → admin 审核 → 标 paid（外部打款由人工/Wise/USDT 处理 · 实际打款 ref 回填）
 */

import { eq, sql } from 'drizzle-orm';
import {
  Database,
  withdrawals,
  therapistEarnings,
  type Withdrawal,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface WithdrawContext {
  db: Database;
}

const MIN_WITHDRAW_CENTS = 5000; // $50

export async function requestWithdrawal(
  ctx: WithdrawContext,
  args: {
    therapistUserId: string;
    amountCents: number;
    method: 'bank' | 'paynow' | 'wise' | 'usdt';
    payoutDetailsEncrypted: string;
  },
): Promise<Withdrawal> {
  if (args.amountCents < MIN_WITHDRAW_CENTS) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `min withdrawal ${MIN_WITHDRAW_CENTS} cents`);
  }

  const earning = await ctx.db.query.therapistEarnings.findFirst({
    where: eq(therapistEarnings.therapistUserId, args.therapistUserId),
  });
  if (!earning || earning.availableCents < args.amountCents) {
    throw HttpError.badRequest(ErrorCode.E2010_BALANCE_INSUFFICIENT, 'insufficient earnings');
  }

  return await ctx.db.transaction(async (tx) => {
    // 冻结
    await tx
      .update(therapistEarnings)
      .set({
        availableCents: sql`${therapistEarnings.availableCents} - ${args.amountCents}`,
        pendingCents: sql`${therapistEarnings.pendingCents} + ${args.amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(therapistEarnings.therapistUserId, args.therapistUserId));

    const [w] = await tx
      .insert(withdrawals)
      .values({
        therapistUserId: args.therapistUserId,
        amountCents: args.amountCents,
        method: args.method,
        payoutDetailsEncrypted: args.payoutDetailsEncrypted,
        status: 'pending',
      })
      .returning();
    return w!;
  });
}

export async function approveWithdrawal(
  ctx: WithdrawContext,
  args: { withdrawalId: string; adminUserId: string; externalTxnRef: string },
): Promise<Withdrawal> {
  const w = await ctx.db.query.withdrawals.findFirst({ where: eq(withdrawals.id, args.withdrawalId) });
  if (!w) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'withdrawal not found');
  if (w.status !== 'pending') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, `already ${w.status}`);
  }

  return await ctx.db.transaction(async (tx) => {
    await tx
      .update(therapistEarnings)
      .set({
        pendingCents: sql`${therapistEarnings.pendingCents} - ${w.amountCents}`,
        withdrawnCents: sql`${therapistEarnings.withdrawnCents} + ${w.amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(therapistEarnings.therapistUserId, w.therapistUserId));

    const [updated] = await tx
      .update(withdrawals)
      .set({
        status: 'paid',
        reviewerUserId: args.adminUserId,
        reviewedAt: new Date(),
        externalTxnRef: args.externalTxnRef,
        paidAt: new Date(),
      })
      .where(eq(withdrawals.id, args.withdrawalId))
      .returning();
    return updated!;
  });
}

export async function rejectWithdrawal(
  ctx: WithdrawContext,
  args: { withdrawalId: string; adminUserId: string; reason: string },
): Promise<Withdrawal> {
  const w = await ctx.db.query.withdrawals.findFirst({ where: eq(withdrawals.id, args.withdrawalId) });
  if (!w) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'withdrawal not found');
  if (w.status !== 'pending') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, `already ${w.status}`);
  }

  return await ctx.db.transaction(async (tx) => {
    // 解冻
    await tx
      .update(therapistEarnings)
      .set({
        availableCents: sql`${therapistEarnings.availableCents} + ${w.amountCents}`,
        pendingCents: sql`${therapistEarnings.pendingCents} - ${w.amountCents}`,
        updatedAt: new Date(),
      })
      .where(eq(therapistEarnings.therapistUserId, w.therapistUserId));

    const [updated] = await tx
      .update(withdrawals)
      .set({
        status: 'rejected',
        reviewerUserId: args.adminUserId,
        reviewedAt: new Date(),
        rejectReason: args.reason,
      })
      .where(eq(withdrawals.id, args.withdrawalId))
      .returning();
    return updated!;
  });
}
