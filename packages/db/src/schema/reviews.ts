/**
 * 评价 + 信誉 · M08
 *
 * - reviews：客户对技师的评价（三维评分 + 文本 + 申诉）
 * - reputation_scores：技师与客户两端的信誉聚合
 *
 * orders.customerRating 是订单上的快捷评分（1-5 整数），
 * reviews 是带三维 + 文本 + AI 摘要的完整评价。
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

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),

    reviewerUserId: uuid('reviewer_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(), // therapist / customer
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetTherapistId: uuid('target_therapist_id').references(() => therapists.id, { onDelete: 'cascade' }),

    // 三维评分（10 分制 · 整数 ×10 存储，最大 100）
    scoreAppearance: integer('score_appearance'),
    scoreBody: integer('score_body'),
    scoreService: integer('score_service').notNull(),

    // 文本
    content: text('content'),
    aiSummary: text('ai_summary'),

    // 结构化标签
    tags: text('tags').array(),

    // 隐私
    isAnonymous: integer('is_anonymous').default(1).notNull(),
    isHidden: integer('is_hidden').default(0).notNull(),

    // 申诉
    appealStatus: text('appeal_status'), // null / pending / resolved / rejected
    appealReason: text('appeal_reason'),
    appealResolution: text('appeal_resolution'),
    appealedAt: timestamp('appealed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxOrderReviewer: uniqueIndex('uidx_review_order_reviewer').on(t.orderId, t.reviewerUserId),
    idxTarget: index('idx_review_target').on(t.targetUserId, t.createdAt),
    idxTherapist: index('idx_review_therapist').on(t.targetTherapistId, t.createdAt),
    idxAppeal: index('idx_review_appeal').on(t.appealStatus),
  }),
);

export const reputationScores = pgTable(
  'reputation_scores',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

    // 综合（0-1000）
    overall: integer('overall').default(500).notNull(),

    // 维度（仅技师有意义）
    scoreAppearance: integer('score_appearance').default(0).notNull(),
    scoreBody: integer('score_body').default(0).notNull(),
    scoreService: integer('score_service').default(0).notNull(),

    // 客户口径
    paymentReliability: integer('payment_reliability').default(80).notNull(),
    behaviorScore: integer('behavior_score').default(80).notNull(),

    // 趋势
    trendJson: jsonb('trend').$type<Array<{ ts: string; value: number }>>().default([]),

    // 计算窗口
    sampleSize: integer('sample_size').default(0).notNull(),
    lastComputedAt: timestamp('last_computed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type ReputationScore = typeof reputationScores.$inferSelect;
