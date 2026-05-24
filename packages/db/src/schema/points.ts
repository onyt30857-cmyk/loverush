/**
 * 积分账户与流水 · 对应 PRD §4.8
 *
 * - points_account：每用户一行账户（余额 / 冻结 / 累计）
 * - points_transaction：所有变动流水（含 idempotency_key 防重）
 *
 * 汇率基准：约 1 USD = 100 积分（PRD §4.8.4）
 * 所有金额单位为整数积分（避免浮点精度问题）
 */

import { pgTable, uuid, text, timestamp, integer, bigint, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { pointsTxnTypeEnum, pointsDirectionEnum } from './enums';

/** 积分账户（每用户一行） */
export const pointsAccount = pgTable(
  'points_account',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

    balance: bigint('balance', { mode: 'number' }).default(0).notNull(),
    frozen: bigint('frozen', { mode: 'number' }).default(0).notNull(),

    totalIn: bigint('total_in', { mode: 'number' }).default(0).notNull(),
    totalOut: bigint('total_out', { mode: 'number' }).default(0).notNull(),

    lastTxnAt: timestamp('last_txn_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxBalance: index('idx_points_acc_balance').on(t.balance),
  }),
);

/** 积分变动流水（不可变） */
export const pointsTransaction = pgTable(
  'points_transaction',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),

    type: pointsTxnTypeEnum('type').notNull(),
    direction: pointsDirectionEnum('direction').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),

    // 关联实体
    relatedOrderId: uuid('related_order_id'),
    relatedUserId: uuid('related_user_id').references(() => users.id, { onDelete: 'set null' }),
    relatedInviteCodeId: uuid('related_invite_code_id'),

    // 描述 / 元数据
    description: text('description'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    // 防重（API 幂等键）
    idempotencyKey: text('idempotency_key'),

    // 反向操作（退款 / 撤销）
    reversedByTxnId: uuid('reversed_by_txn_id'),
    reversesTxnId: uuid('reverses_txn_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUserCreated: index('idx_points_txn_user_created').on(t.userId, t.createdAt),
    idxType: index('idx_points_txn_type').on(t.type),
    idxRelatedOrder: index('idx_points_txn_related_order').on(t.relatedOrderId),
    uidxIdempotency: uniqueIndex('uidx_points_txn_idempotency').on(t.userId, t.idempotencyKey),
  }),
);

export type PointsAccount = typeof pointsAccount.$inferSelect;
export type NewPointsAccount = typeof pointsAccount.$inferInsert;
export type PointsTransaction = typeof pointsTransaction.$inferSelect;
export type NewPointsTransaction = typeof pointsTransaction.$inferInsert;
