/**
 * 订单与凭证链 · 对应 PRD §4.5 / §4.0.8
 *
 * - orders：订单主表（11 状态机）
 * - order_chain：凭证链事件（17 种事件，append-only，可哈希链验证）
 */

import { pgTable, uuid, text, timestamp, integer, bigint, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';
import { orderStatusEnum, orderChainEventEnum } from './enums';

/** 订单主表 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNo: text('order_no').notNull().unique(), // 业务订单号（年月日+随机）

    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    therapistId: uuid('therapist_id').notNull().references(() => therapists.id, { onDelete: 'restrict' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),

    // 状态
    status: orderStatusEnum('status').default('DRAFT').notNull(),

    // 服务内容
    serviceSnapshot: jsonb('service_snapshot').$type<{
      skills: string[];
      durationMin: number;
      pricePoints: number;
      itemsBreakdown?: Array<{ name: string; pricePoints: number }>;
    }>().notNull(),

    // 价格（锁价 · §4.5）
    pricePoints: bigint('price_points', { mode: 'number' }).notNull(),
    priceLockedAt: timestamp('price_locked_at', { withTimezone: true }),
    priceLockHash: text('price_lock_hash'), // 锁价快照哈希

    // 支付
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentTxnId: text('payment_txn_id'), // Stripe pi_xxx / Adyen psp_xxx · 不是 UUID

    // 服务时间
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // 评价
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    customerRating: integer('customer_rating'), // 1-5
    customerReview: text('customer_review'),

    // 退款 / 争议
    disputeOpenedAt: timestamp('dispute_opened_at', { withTimezone: true }),
    disputeReason: text('dispute_reason'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundPoints: bigint('refund_points', { mode: 'number' }),

    // 元数据
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCustomer: index('idx_orders_customer').on(t.customerId, t.createdAt),
    idxTherapist: index('idx_orders_therapist').on(t.therapistId, t.createdAt),
    idxStatus: index('idx_orders_status').on(t.status),
    idxOrderNo: index('idx_orders_no').on(t.orderNo),
  }),
);

/** 订单凭证链（append-only · 哈希链验证） */
export const orderChain = pgTable(
  'order_chain',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),

    seq: integer('seq').notNull(), // 链内顺序号（从 1 开始）
    event: orderChainEventEnum('event').notNull(),

    // 事件数据
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'), // customer / therapist / system / admin

    // 哈希链（验证不可篡改）
    prevHash: text('prev_hash'),
    eventHash: text('event_hash').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrderSeq: index('idx_chain_order_seq').on(t.orderId, t.seq),
    idxEvent: index('idx_chain_event').on(t.event),
    idxActor: index('idx_chain_actor').on(t.actorUserId),
  }),
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderChain = typeof orderChain.$inferSelect;
export type NewOrderChain = typeof orderChain.$inferInsert;
