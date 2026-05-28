/**
 * 小费 · M09c
 *
 * 客户主动给技师小费，平台抽 12%（默认）。
 * - 扣客户积分（grossPoints）
 * - 给技师积分（netPoints）+ 现金口径（USD cents）
 * - 平台 fee 入平台账户（可后处理）
 *
 * 派单优先权 + 服务后感谢两种时机。
 */

import { eq, sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  tips,
  therapistEarnings,
  therapists,
  type Tip,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { credit, debit, type PointsContext } from './points';

export interface TipsContext {
  db: Database;
}

const DEFAULT_FEE_BPS = 1200; // 12%
const POINTS_PER_USD = 100;

export interface GiveTipArgs {
  customerId: string;
  therapistId: string;
  grossPoints: number;
  timing?: 'pre_service' | 'post_service';
  message?: string;
  orderId?: string;
  feeBpsOverride?: number;
}

export async function giveTip(ctx: TipsContext, args: GiveTipArgs): Promise<Tip> {
  if (args.grossPoints <= 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'amount must be > 0');
  }

  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.id, args.therapistId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  const feeBps = args.feeBpsOverride ?? DEFAULT_FEE_BPS;
  const platformFee = Math.floor((args.grossPoints * feeBps) / 10000);
  const netPoints = args.grossPoints - platformFee;

  const idempotencyBase = `tip.${args.customerId}.${args.therapistId}.${Date.now()}`;

  // 客户扣积分（全额）
  await debit({ db: ctx.db }, {
    userId: args.customerId,
    type: 'TIP_GIVE',
    amount: args.grossPoints,
    description: `小费给技师 ${t.id}`,
    relatedUserId: t.userId,
    relatedOrderId: args.orderId,
    metadata: { grossPoints: args.grossPoints, feeBps, platformFee, netPoints, timing: args.timing ?? 'pre_service' },
    idempotencyKey: `${idempotencyBase}.out`,
  });

  // 技师收净额积分
  await credit({ db: ctx.db }, {
    userId: t.userId,
    type: 'TIP_RECEIVE',
    amount: netPoints,
    description: `收到小费 from ${args.customerId}`,
    relatedUserId: args.customerId,
    relatedOrderId: args.orderId,
    metadata: { grossPoints: args.grossPoints, feeBps, platformFee, netPoints, timing: args.timing ?? 'pre_service' },
    idempotencyKey: `${idempotencyBase}.in`,
  });

  // 现金口径
  const netCents = Math.floor((netPoints * 100) / POINTS_PER_USD);
  await ctx.db
    .insert(therapistEarnings)
    .values({
      therapistUserId: t.userId,
      availableCents: netCents,
      tipEarningsCents: netCents,
    })
    .onConflictDoUpdate({
      target: therapistEarnings.therapistUserId,
      set: {
        availableCents: sql`${therapistEarnings.availableCents} + ${netCents}`,
        tipEarningsCents: sql`${therapistEarnings.tipEarningsCents} + ${netCents}`,
        updatedAt: new Date(),
      },
    });

  const [row] = await ctx.db
    .insert(tips)
    .values({
      customerId: args.customerId,
      therapistId: t.id,
      therapistUserId: t.userId,
      orderId: args.orderId,
      grossPoints: args.grossPoints,
      platformFeeBps: feeBps,
      platformFeePoints: platformFee,
      netPoints,
      timing: args.timing ?? 'pre_service',
      message: args.message,
    })
    .returning();
  return row!;
}
