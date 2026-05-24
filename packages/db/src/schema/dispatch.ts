/**
 * 派单 · M04 匹配与分发
 *
 * 简化模型：客户在 orders 表创建 DRAFT 订单 + 同步广播给 N 个候选技师。
 * 技师对该 order 创建 dispatch_offer（accept / decline），首个 accept 锁定该订单到该技师。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';
import { orders } from './orders';

export const dispatchOffers = pgTable(
  'dispatch_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistId: uuid('therapist_id').notNull().references(() => therapists.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 状态：pending / accepted / declined / expired / superseded
    status: text('status').default('pending').notNull(),

    // 评分（用于 ranking · 越大越优）
    matchScore: integer('match_score').default(0).notNull(),
    matchFactors: jsonb('match_factors').$type<Record<string, number>>().default({}),

    // 出价 / 反价（v2 留口子）
    counterOfferPoints: integer('counter_offer_points'),
    note: text('note'),

    // 时间
    broadcastedAt: timestamp('broadcasted_at', { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    uidxOrderTher: uniqueIndex('uidx_dispatch_order_ther').on(t.orderId, t.therapistId),
    idxOrder: index('idx_dispatch_order').on(t.orderId, t.status),
    idxTherapist: index('idx_dispatch_therapist').on(t.therapistId, t.status),
    idxExpires: index('idx_dispatch_expires').on(t.expiresAt),
  }),
);

export type DispatchOffer = typeof dispatchOffers.$inferSelect;
export type NewDispatchOffer = typeof dispatchOffers.$inferInsert;
