/**
 * 客户-技师关系画像（M06 核心）· 对应 PRD §4.6
 *
 * customer_relationship_profile：每对 (customer, therapist) 一行
 * 记录 L0-L3 四档亲密度 + 跨次会话连续性
 */

import { pgTable, uuid, text, timestamp, integer, bigint, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';
import { relationshipTierEnum } from './enums';

export const customerRelationshipProfile = pgTable(
  'customer_relationship_profile',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistId: uuid('therapist_id').notNull().references(() => therapists.id, { onDelete: 'cascade' }),

    // 亲密度档位
    tier: relationshipTierEnum('tier').default('L0').notNull(),
    tierScore: integer('tier_score').default(0).notNull(), // 0-1000
    lastTierChangeAt: timestamp('last_tier_change_at', { withTimezone: true }),

    // 统计
    totalOrders: integer('total_orders').default(0).notNull(),
    totalSpentPoints: bigint('total_spent_points', { mode: 'number' }).default(0).notNull(),
    totalTipPoints: bigint('total_tip_points', { mode: 'number' }).default(0).notNull(),

    firstOrderAt: timestamp('first_order_at', { withTimezone: true }),
    lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),

    // 评价
    avgRating: integer('avg_rating').default(0).notNull(), // 0-500
    ratingCount: integer('rating_count').default(0).notNull(),

    // 私密度（仅对该技师可见的客户画像）
    privateNotes: text('private_notes'), // 技师端记录
    customerNickname: text('customer_nickname'), // 技师对该客户的昵称
    privateTags: text('private_tags').array(),

    // AI 分身使用画像（用于个性化打招呼）
    interactionMemory: jsonb('interaction_memory').$type<Record<string, unknown>>().default({}),

    // 黑名单 / 静默
    isBlocked: integer('is_blocked').default(0).notNull(),
    blockedBy: text('blocked_by'), // customer / therapist
    blockedAt: timestamp('blocked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_relationship_pair').on(t.customerId, t.therapistId),
    idxCustomer: index('idx_relationship_customer').on(t.customerId, t.tier),
    idxTherapist: index('idx_relationship_therapist').on(t.therapistId, t.tier),
    idxLastOrder: index('idx_relationship_last_order').on(t.lastOrderAt),
  }),
);

export type CustomerRelationshipProfile = typeof customerRelationshipProfile.$inferSelect;
export type NewCustomerRelationshipProfile = typeof customerRelationshipProfile.$inferInsert;
