/**
 * M18 心动陪伴（陪聊付费）service
 *
 * triggerCompanionAction：客户对技师发起一个亲密动作
 *   1. 查 companion_actions（按 code，且 isActive=1）
 *   2. debit 客户 pricePoints（余额不足由 debit 内部抛 E2010）
 *   3. credit 技师分成（Math.floor(price * revenueShareBps / 10000)），平台留差额
 *   4. upsert intimacy 经验值（+expReward）
 *
 * getIntimacy：查客户 × 技师亲密度（exp / level）
 *
 * 计费走 points.ts 的 debit/credit（原子 + 幂等 + 流水）。
 * txnType 复用 CHAT_SPEND / CHAT_EARN（陪聊付费 ≈ 聊天消费/收入），
 * 用 metadata.scene='companion' 区分来源。
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { companionActions, intimacy } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { credit, debit } from './points';

export interface CompanionContext {
  db: Database;
}

/** 亲密度等级阈值（exp 下界）· 0 陌生 1 熟悉 2 暧昧 3 心动 4 专属。待 Tony 调曲线。 */
export const INTIMACY_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700] as const;
export function levelForExp(exp: number): number {
  let lvl = 0;
  for (let i = 0; i < INTIMACY_LEVEL_THRESHOLDS.length; i++) {
    if (exp >= INTIMACY_LEVEL_THRESHOLDS[i]!) lvl = i;
  }
  return lvl;
}

export interface TriggerCompanionArgs {
  customerId: string;
  therapistUserId: string;
  actionCode: string;
}

export interface TriggerCompanionResult {
  action: string;
  pricePoints: number;
  intimacyExp: number;
  level: number;
}

export async function triggerCompanionAction(
  ctx: CompanionContext,
  args: TriggerCompanionArgs,
): Promise<TriggerCompanionResult> {
  const { customerId, therapistUserId, actionCode } = args;

  const action = await ctx.db.query.companionActions.findFirst({
    where: and(eq(companionActions.code, actionCode), eq(companionActions.isActive, 1)),
  });
  if (!action) {
    throw HttpError.badRequest(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'companion action not found');
  }

  const pricePoints = action.pricePoints;
  const ts = Date.now();
  const baseKey = `companion.${customerId}.${therapistUserId}.${actionCode}.${ts}`;

  // 1. 客户出账（余额不足 → debit 内部抛 E2010_BALANCE_INSUFFICIENT）
  await debit(
    { db: ctx.db },
    {
      userId: customerId,
      type: 'CHAT_SPEND',
      amount: pricePoints,
      description: `companion:${actionCode}`,
      relatedUserId: therapistUserId,
      idempotencyKey: baseKey,
      metadata: { scene: 'companion', actionCode },
    },
  );

  // 2. 技师分成入账（平台留差额，隐式）
  const share = Math.floor((pricePoints * action.revenueShareBps) / 10000);
  if (share > 0) {
    await credit(
      { db: ctx.db },
      {
        userId: therapistUserId,
        type: 'CHAT_EARN',
        amount: share,
        description: `companion:${actionCode}`,
        relatedUserId: customerId,
        idempotencyKey: `${baseKey}.share`,
        metadata: { scene: 'companion', actionCode },
      },
    );
  }

  // 3. 亲密度 upsert（+expReward）· returning 拿最新 exp 算 level
  const [row] = await ctx.db
    .insert(intimacy)
    .values({ customerId, therapistUserId, exp: action.expReward })
    .onConflictDoUpdate({
      target: [intimacy.customerId, intimacy.therapistUserId],
      set: {
        exp: sql`${intimacy.exp} + ${action.expReward}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const newExp = row?.exp ?? action.expReward;
  const newLevel = levelForExp(newExp);
  // level 升级则落库（intimacy.level 只在变化时写，省一次无谓 update）
  if (row && row.level !== newLevel) {
    await ctx.db
      .update(intimacy)
      .set({ level: newLevel, updatedAt: new Date() })
      .where(
        and(
          eq(intimacy.customerId, customerId),
          eq(intimacy.therapistUserId, therapistUserId),
        ),
      );
  }

  return {
    action: actionCode,
    pricePoints,
    intimacyExp: action.expReward,
    level: newLevel,
  };
}

export interface GetIntimacyArgs {
  customerId: string;
  therapistUserId: string;
}

export interface IntimacyResult {
  exp: number;
  level: number;
}

export async function getIntimacy(
  ctx: CompanionContext,
  args: GetIntimacyArgs,
): Promise<IntimacyResult> {
  const row = await ctx.db.query.intimacy.findFirst({
    where: and(
      eq(intimacy.customerId, args.customerId),
      eq(intimacy.therapistUserId, args.therapistUserId),
    ),
  });
  return { exp: row?.exp ?? 0, level: row?.level ?? 0 };
}
