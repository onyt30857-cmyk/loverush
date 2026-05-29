/**
 * 通知群发 · M13 Phase 0
 *
 * 2 张表:
 * 1. notification_broadcasts             群发批次主表(草稿/发送/完成)
 * 2. notification_broadcast_deliveries   投递明细(每用户一行 · sent/skipped/failed)
 *
 * 设计原则:
 * - enabled/bypass_user_prefs 用 integer(1/0)对齐 codebase 惯例
 * - audience_rule 用 jsonb 存类型联合(AudienceRule)· 解析/校验在 service 层
 * - bodyTranslations 与 notifications 表同款结构(已有惯例)
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { notifications } from './notifications';

// ─────────────────── AudienceRule jsonb 内容契约 ───────────────────

export type AudienceRule =
  | { kind: 'all_active'; userType?: 'customer' | 'therapist' }
  | { kind: 'by_city'; cities: string[]; userType?: 'customer' | 'therapist' }
  | { kind: 'by_locale'; locales: string[]; userType?: 'customer' | 'therapist' }
  | { kind: 'dormant'; daysSince: number; userType: 'customer' | 'therapist' }
  | { kind: 'high_value'; minOrders: number };

export type BroadcastStatus = 'draft' | 'sending' | 'completed' | 'failed';

// ─────────────────── 1. 群发批次主表 ───────────────────

export const notificationBroadcasts = pgTable(
  'notification_broadcasts',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    /** admin 用户 id · 谁创建 */
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** 内部识别名 · 如 '0530 春节活动' */
    name: text('name').notNull(),

    /** 内容(对应 notifications 表同名字段) */
    title: text('title').notNull(),
    body: text('body'),
    bodyTranslations: jsonb('body_translations').$type<Record<string, { title: string; body?: string }>>(),
    level: text('level').notNull().default('info'),
    category: text('category').notNull().default('promo'),
    deepLink: text('deep_link'),

    /** 受众规则(AudienceRule jsonb)· 计算预览时回填 audienceCount */
    audienceRule: jsonb('audience_rule').$type<AudienceRule>().notNull(),
    audienceCount: integer('audience_count').notNull().default(0),

    /** 投递配置 */
    channels: text('channels').array().notNull().default([] as string[]),
    bypassUserPrefs: integer('bypass_user_prefs').notNull().default(0),

    /** 状态机 · draft → sending → completed | failed */
    status: text('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** 统计快照(运行时回填) */
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),

    /** 异常摘要 */
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxStatusCreated: index('idx_broadcast_status_created').on(t.status, t.createdAt),
    idxCreator: index('idx_broadcast_creator').on(t.createdByAdminId),
  }),
);

export type NotificationBroadcast = typeof notificationBroadcasts.$inferSelect;
export type NewNotificationBroadcast = typeof notificationBroadcasts.$inferInsert;

// ─────────────────── 2. 投递明细 ───────────────────

export const notificationBroadcastDeliveries = pgTable(
  'notification_broadcast_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    broadcastId: uuid('broadcast_id')
      .notNull()
      .references(() => notificationBroadcasts.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 关联到生成的 notifications 行 · null 表示 skipped/failed 没生成 */
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    /** sent | skipped | failed */
    status: text('status').notNull(),
    /** skipReason: 'pref_off' | 'banned' | 'no_user' | error msg */
    skipReason: text('skip_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_broadcast_delivery_pair').on(t.broadcastId, t.recipientUserId),
    idxStatus: index('idx_broadcast_delivery_status').on(t.broadcastId, t.status),
  }),
);

export type NotificationBroadcastDelivery = typeof notificationBroadcastDeliveries.$inferSelect;
export type NewNotificationBroadcastDelivery = typeof notificationBroadcastDeliveries.$inferInsert;
