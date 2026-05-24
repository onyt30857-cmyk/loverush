/**
 * 付费墙 · M09b
 *
 * 客户消耗积分解锁：
 * - social_contacts：技师联系方式
 * - gallery_paid：高清付费相册（按整组）
 *
 * 解锁记录用 points_transaction.metadata 承载（避免新表）：
 *   { unlockType: 'social_contacts', targetUserId, targetTherapistId }
 *
 * 查询解锁状态：扫客户 points_transaction.type=PAYWALL_UNLOCK + metadata 匹配
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  Database,
  pointsTransaction,
  therapists,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { debit, type PointsContext } from './points';

export interface PaywallContext {
  db: Database;
}

export type UnlockType = 'social_contacts' | 'gallery_paid';

const UNLOCK_PRICES: Record<UnlockType, number> = {
  social_contacts: 100,
  gallery_paid: 200,
};

export async function unlock(
  ctx: PaywallContext,
  args: { customerId: string; therapistId: string; unlockType: UnlockType },
): Promise<{ alreadyUnlocked: boolean; pricePoints: number }> {
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.id, args.therapistId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  const exists = await isUnlocked(ctx, args);
  if (exists) return { alreadyUnlocked: true, pricePoints: 0 };

  const price = args.unlockType === 'social_contacts'
    ? t.socialUnlockPricePoints ?? UNLOCK_PRICES.social_contacts
    : UNLOCK_PRICES.gallery_paid;

  await debit({ db: ctx.db } as PointsContext, {
    userId: args.customerId,
    type: 'PAYWALL_UNLOCK',
    amount: price,
    description: `解锁 ${args.unlockType} · 技师 ${args.therapistId}`,
    metadata: {
      unlockType: args.unlockType,
      targetTherapistId: args.therapistId,
      targetUserId: t.userId,
    },
    idempotencyKey: `unlock.${args.customerId}.${args.therapistId}.${args.unlockType}`,
  });

  return { alreadyUnlocked: false, pricePoints: price };
}

export async function isUnlocked(
  ctx: PaywallContext,
  args: { customerId: string; therapistId: string; unlockType: UnlockType },
): Promise<boolean> {
  const result = await ctx.db.execute(sql`
    SELECT 1 FROM points_transaction
    WHERE user_id = ${args.customerId}
      AND type = 'PAYWALL_UNLOCK'
      AND direction = 'OUT'
      AND metadata->>'unlockType' = ${args.unlockType}
      AND metadata->>'targetTherapistId' = ${args.therapistId}
    LIMIT 1
  `);
  return result.length > 0;
}

/** 给定 customer + therapist 列表所有已解锁项 */
export async function listUnlocked(
  ctx: PaywallContext,
  customerId: string,
  therapistId: string,
): Promise<UnlockType[]> {
  const result = await ctx.db.execute(sql`
    SELECT DISTINCT metadata->>'unlockType' AS unlock_type
    FROM points_transaction
    WHERE user_id = ${customerId}
      AND type = 'PAYWALL_UNLOCK'
      AND direction = 'OUT'
      AND metadata->>'targetTherapistId' = ${therapistId}
  `);
  return result.map((r) => (r as { unlock_type: string }).unlock_type).filter(Boolean) as UnlockType[];
}
