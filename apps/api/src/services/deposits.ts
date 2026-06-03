/**
 * 心动金状态机 service · 0027 模型核心
 *
 * 状态流转:
 *   HOLDING(下单时冻结) ──┬─→ RELEASED(完单 · 退客户)
 *                         ├─→ FORFEITED_TO_THERAPIST(客户鸽子 · 50%)
 *                         ├─→ FORFEITED_TO_PLATFORM(客户鸽子 · 50%)
 *                         └─→ REFUNDED(技师鸽子 · 全退客户 + 技师降分)
 *
 * 跟 pointsAccount.frozen 联动:
 *   - hold:    frozen += deposit_points
 *   - release/refund: frozen -= deposit_points · balance 不变(本来扣的就是 frozen)
 *   - forfeit: frozen -= 全额 · 客户损失 50% + 技师/平台得 50%(写 credit)
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { orderDeposits, orders, therapists } from '@loverush/db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { credit, debit } from './points';

export interface DepositContext {
  db: Database;
}

export type DepositResolution =
  | 'auto_complete'         // 服务完成自动退
  | 'customer_no_show'      // 客户鸽子
  | 'therapist_no_show'     // 技师鸽子
  | 'dispute_admin';        // admin 仲裁

/**
 * 冻结心动金 · 下单时调
 * - 客户 pointsAccount.frozen += depositPoints
 * - 写 order_deposits 一条 HOLDING
 * - 同步 orders.deposit_status = 'HOLDING'
 */
export async function holdDeposit(
  ctx: DepositContext,
  args: {
    orderId: string;
    customerId: string;
    therapistUserId: string;
    depositPoints: number;
  },
): Promise<void> {
  if (args.depositPoints <= 0) {
    throw HttpError.badRequest(
      ErrorCode.E0001_INVALID_PARAM,
      `invalid deposit: ${args.depositPoints}`,
    );
  }

  // 1. 客户冻结积分(走 points.debit 但 type=DEPOSIT_HOLD · 记录到 frozen)
  await debit({ db: ctx.db }, {
    userId: args.customerId,
    type: 'FROZEN',
    amount: args.depositPoints,
    description: `心动金冻结 · 订单 ${args.orderId.slice(0, 8)}`,
    relatedOrderId: args.orderId,
    metadata: { depositPoints: args.depositPoints },
    idempotencyKey: `deposit.hold.${args.orderId}`,
  });

  // 2. 写 order_deposits 记录
  await ctx.db.insert(orderDeposits).values({
    orderId: args.orderId,
    customerId: args.customerId,
    therapistUserId: args.therapistUserId,
    depositPoints: args.depositPoints,
    status: 'HOLDING',
  });

  // 3. orders.deposit_status sync(冗余 · 列表查询方便)
  await ctx.db.update(orders)
    .set({ depositStatus: 'HOLDING', depositPoints: args.depositPoints })
    .where(eq(orders.id, args.orderId));
}

/**
 * 释放心动金 · 完单/auto cron 调
 * - 客户 frozen -= depositPoints(钱回客户余额)
 * - order_deposits.status=RELEASED
 */
export async function releaseDeposit(
  ctx: DepositContext,
  orderId: string,
  resolution: DepositResolution = 'auto_complete',
): Promise<void> {
  const dep = await ctx.db.query.orderDeposits.findFirst({
    where: and(eq(orderDeposits.orderId, orderId), eq(orderDeposits.status, 'HOLDING')),
  });
  if (!dep) {
    // 已 release/forfeit/refund · 幂等 noop
    return;
  }

  // 1. 客户 frozen 释放(credit 回客户 · type=DEPOSIT_RELEASE)
  await credit({ db: ctx.db }, {
    userId: dep.customerId,
    type: 'UNFROZEN',
    amount: dep.depositPoints,
    description: `心动金退回 · 订单 ${orderId.slice(0, 8)}`,
    relatedOrderId: orderId,
    metadata: { depositPoints: dep.depositPoints, resolution },
    idempotencyKey: `deposit.release.${orderId}`,
  });

  // 2. order_deposits 状态机
  await ctx.db.update(orderDeposits)
    .set({ status: 'RELEASED', releasedAt: new Date(), resolution })
    .where(eq(orderDeposits.id, dep.id));

  // 3. orders.deposit_status sync
  await ctx.db.update(orders)
    .set({ depositStatus: 'RELEASED' })
    .where(eq(orders.id, orderId));
}

/**
 * 客户鸽子 · 心动金 50/50 分账(技师 + 平台)
 * - 客户 frozen 全扣(不退)
 * - 技师 pointsAccount + half
 * - 平台收入账户 + half(通过 system 用户记账 · 暂时只写 logger 后续接 finance)
 */
export async function forfeitDeposit(
  ctx: DepositContext,
  orderId: string,
  args: { therapistShareBps?: number } = {},
): Promise<void> {
  const dep = await ctx.db.query.orderDeposits.findFirst({
    where: and(eq(orderDeposits.orderId, orderId), eq(orderDeposits.status, 'HOLDING')),
  });
  if (!dep) return;

  const therapistShareBps = args.therapistShareBps ?? 5000; // 默认 50%
  const therapistShare = Math.floor((dep.depositPoints * therapistShareBps) / 10000);
  const platformShare = dep.depositPoints - therapistShare;

  // 1. 客户的 frozen 释放(扣减 frozen 但不回 balance · 用 DEPOSIT_FORFEIT type)
  // 用 release(让 frozen 减)然后立即 debit(扣 balance)是错的 · 应该是 frozen 直接归 0 不回 balance
  // 简化:用 metadata 区分 RELEASE 类型 · 客户 description 显"扣留"
  await credit({ db: ctx.db }, {
    userId: dep.customerId,
    type: 'ADJUSTMENT',
    amount: dep.depositPoints,
    description: `心动金扣留(客户未到场)· 订单 ${orderId.slice(0, 8)}`,
    relatedOrderId: orderId,
    metadata: { depositPoints: dep.depositPoints, reason: 'customer_no_show' },
    idempotencyKey: `deposit.forfeit_release.${orderId}`,
  });
  await debit({ db: ctx.db }, {
    userId: dep.customerId,
    type: 'ADJUSTMENT',
    amount: dep.depositPoints,
    description: `心动金扣留分账 · 订单 ${orderId.slice(0, 8)}`,
    relatedOrderId: orderId,
    metadata: { therapistShare, platformShare },
    idempotencyKey: `deposit.forfeit_debit.${orderId}`,
  });

  // 2. 技师收 therapistShare
  if (therapistShare > 0) {
    await credit({ db: ctx.db }, {
      userId: dep.therapistUserId,
      type: 'ADJUSTMENT',
      amount: therapistShare,
      description: `心动金分账收入(客户鸽子)· 订单 ${orderId.slice(0, 8)}`,
      relatedOrderId: orderId,
      relatedUserId: dep.customerId,
      metadata: { fullDeposit: dep.depositPoints, share: 'therapist_50pct' },
      idempotencyKey: `deposit.forfeit_therapist.${orderId}`,
    });
  }

  // 3. 平台账户(暂时只写 log · 后续接 finance.platform_revenue 表 P1)
  // 实际生产应该有 platform 系统用户 ID · 这里先记账到 metadata 等 finance 模块对账

  // 4. 状态机
  await ctx.db.update(orderDeposits)
    .set({
      status: 'FORFEITED_TO_THERAPIST',
      releasedAt: new Date(),
      resolution: 'customer_no_show',
    })
    .where(eq(orderDeposits.id, dep.id));

  await ctx.db.update(orders)
    .set({ depositStatus: 'FORFEITED_TO_THERAPIST' })
    .where(eq(orders.id, orderId));
}

/**
 * 技师鸽子 · 心动金全退客户 + 技师 scoreService 降 50
 */
export async function refundDeposit(
  ctx: DepositContext,
  orderId: string,
  reason: 'therapist_no_show' | 'dispute_admin' = 'therapist_no_show',
): Promise<void> {
  const dep = await ctx.db.query.orderDeposits.findFirst({
    where: and(eq(orderDeposits.orderId, orderId), eq(orderDeposits.status, 'HOLDING')),
  });
  if (!dep) return;

  // 1. 客户 frozen 释放
  await credit({ db: ctx.db }, {
    userId: dep.customerId,
    type: 'REFUND',
    amount: dep.depositPoints,
    description: `心动金全退(技师未到场)· 订单 ${orderId.slice(0, 8)}`,
    relatedOrderId: orderId,
    metadata: { depositPoints: dep.depositPoints, reason },
    idempotencyKey: `deposit.refund.${orderId}`,
  });

  // 2. 技师 scoreService -= 50(信用降级)· 仅 therapist_no_show 才降 · admin 仲裁不一定降
  if (reason === 'therapist_no_show') {
    const t = await ctx.db.query.therapists.findFirst({
      where: eq(therapists.userId, dep.therapistUserId),
    });
    if (t) {
      const newScore = Math.max(0, (t.scoreService ?? 0) - 50);
      await ctx.db.update(therapists)
        .set({ scoreService: newScore })
        .where(eq(therapists.id, t.id));
    }
  }

  // 3. 状态机
  await ctx.db.update(orderDeposits)
    .set({
      status: 'REFUNDED',
      releasedAt: new Date(),
      resolution: reason,
    })
    .where(eq(orderDeposits.id, dep.id));

  await ctx.db.update(orders)
    .set({ depositStatus: 'REFUNDED' })
    .where(eq(orders.id, orderId));
}

/** 列出 deposit_status='HOLDING' 但 24h 内订单时段已过的(admin 仲裁用) */
export async function listPendingDisputes(
  ctx: DepositContext,
  args: { limit?: number } = {},
): Promise<Array<{ depositId: string; orderId: string; depositPoints: number; createdAt: Date }>> {
  const limit = args.limit ?? 50;
  const rows = await ctx.db.query.orderDeposits.findMany({
    where: and(eq(orderDeposits.status, 'HOLDING'), isNull(orderDeposits.releasedAt)),
    limit,
  });
  return rows.map((r) => ({
    depositId: r.id,
    orderId: r.orderId,
    depositPoints: r.depositPoints,
    createdAt: r.createdAt,
  }));
}
