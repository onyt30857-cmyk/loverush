/**
 * 小费 + 提现 · M09c
 *
 * - tips：客户主动给的小费（预约时给 → 派单优先权 + 服务后感谢）
 * - therapist_earnings：技师可提现账户（现金 vs 积分分离）
 * - withdrawals：提现申请工单
 *
 * 平台对小费抽 10-15%（v1 默认 12%）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';
import { orders } from './orders';

export const tips = pgTable(
  'tips',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    therapistId: uuid('therapist_id').notNull().references(() => therapists.id, { onDelete: 'restrict' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),

    // 金额
    grossPoints: bigint('gross_points', { mode: 'number' }).notNull(),
    platformFeeBps: integer('platform_fee_bps').default(1200).notNull(), // 12%
    platformFeePoints: bigint('platform_fee_points', { mode: 'number' }).notNull(),
    netPoints: bigint('net_points', { mode: 'number' }).notNull(),

    // 时机：pre_service（派单优先） / post_service（事后感谢）
    timing: text('timing').default('pre_service').notNull(),

    // 留言
    message: text('message'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCustomer: index('idx_tips_customer').on(t.customerId, t.createdAt),
    idxTherapist: index('idx_tips_therapist').on(t.therapistId, t.createdAt),
    idxOrder: index('idx_tips_order').on(t.orderId),
  }),
);

/** 技师可提现账户（现金口径 · 与积分账户独立） */
export const therapistEarnings = pgTable(
  'therapist_earnings',
  {
    therapistUserId: uuid('therapist_user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

    // 余额：USD cents（与积分账户独立的现金口径）
    availableCents: bigint('available_cents', { mode: 'number' }).default(0).notNull(),
    pendingCents: bigint('pending_cents', { mode: 'number' }).default(0).notNull(),
    withdrawnCents: bigint('withdrawn_cents', { mode: 'number' }).default(0).notNull(),

    // 来源累计
    tipEarningsCents: bigint('tip_earnings_cents', { mode: 'number' }).default(0).notNull(),
    shopCommissionCents: bigint('shop_commission_cents', { mode: 'number' }).default(0).notNull(),
    inviteRewardsCents: bigint('invite_rewards_cents', { mode: 'number' }).default(0).notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

/** 提现申请 */
export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),

    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').default('USD').notNull(),

    method: text('method').notNull(), // bank / paynow / wise / usdt
    payoutDetailsEncrypted: text('payout_details_encrypted'),

    status: text('status').default('pending').notNull(), // pending / processing / paid / rejected / cancelled

    // 处理
    reviewerUserId: uuid('reviewer_user_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),

    // 实际打款
    externalTxnRef: text('external_txn_ref'),
    paidAt: timestamp('paid_at', { withTimezone: true }),

    audit: jsonb('audit').$type<Record<string, unknown>>().default({}),

    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapist: index('idx_withdraw_therapist').on(t.therapistUserId, t.requestedAt),
    idxStatus: index('idx_withdraw_status').on(t.status),
  }),
);

export type Tip = typeof tips.$inferSelect;
export type NewTip = typeof tips.$inferInsert;
export type TherapistEarning = typeof therapistEarnings.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type NewWithdrawal = typeof withdrawals.$inferInsert;
