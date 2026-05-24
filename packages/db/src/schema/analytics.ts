/**
 * 埋点 · M14 数据看板
 *
 * v1 单表 analytics_events（PostgreSQL · 不依赖 TimescaleDB）
 * v2 上规模后切到 ClickHouse / TimescaleDB。
 *
 * 事件按类型 + 时间分区索引；聚合查询用预聚合表。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventName: text('event_name').notNull(),
    eventCategory: text('event_category').notNull(), // ui / order / payment / chat / ai / risk

    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'), // customer / therapist / system / admin

    // 业务关联
    refType: text('ref_type'), // order / message / therapist / shop_item
    refId: uuid('ref_id'),

    // payload
    properties: jsonb('properties').$type<Record<string, unknown>>().default({}),

    // 客户端环境
    locale: text('locale'),
    deviceFingerprintHash: text('device_fingerprint_hash'),
    ipHash: text('ip_hash'),

    // 时间
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxEventOccurred: index('idx_analytics_event_occurred').on(t.eventName, t.occurredAt),
    idxCategoryOccurred: index('idx_analytics_category_occurred').on(t.eventCategory, t.occurredAt),
    idxActor: index('idx_analytics_actor').on(t.actorUserId),
    idxRef: index('idx_analytics_ref').on(t.refType, t.refId),
  }),
);

/** 预聚合（按 day 桶） */
export const analyticsDailyAgg = pgTable(
  'analytics_daily_agg',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bucketDate: text('bucket_date').notNull(), // YYYY-MM-DD
    eventName: text('event_name').notNull(),
    dimension: text('dimension'), // city / locale / userType / null
    dimensionValue: text('dimension_value'),

    countTotal: bigint('count_total', { mode: 'number' }).default(0).notNull(),
    countUnique: bigint('count_unique', { mode: 'number' }).default(0).notNull(),
    sumValue: bigint('sum_value', { mode: 'number' }).default(0).notNull(),

    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxBucketEvent: index('idx_agg_bucket_event').on(t.bucketDate, t.eventName),
  }),
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
export type AnalyticsDailyAgg = typeof analyticsDailyAgg.$inferSelect;
