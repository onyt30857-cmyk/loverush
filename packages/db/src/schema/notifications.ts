/**
 * 消息与通知 · M13
 *
 * - notifications：所有站内通知（含推送）
 * - user_push_preferences：用户级推送偏好
 * - web_push_subscriptions：Web Push 订阅端点（service worker）
 *
 * 注：H5 项目，渠道仅支持 in_app + web_push + telegram_mini_app + email。无原生 iOS/Android push。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipientUserId: uuid('recipient_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 分级
    level: text('level').default('info').notNull(), // critical / important / info / silent
    category: text('category').notNull(),
    // chat_msg / order_status / dispatch_offer / review / withdraw / system / promo

    // 内容
    title: text('title').notNull(),
    body: text('body'),
    bodyTranslations: jsonb('body_translations').$type<Record<string, string>>(),
    deepLink: text('deep_link'),

    // 关联
    refType: text('ref_type'),
    refId: uuid('ref_id'),

    // 推送 fan-out 状态
    channels: text('channels').array().default([]), // in_app / web_push / telegram_mini_app / email
    pushedAt: jsonb('pushed_at').$type<Record<string, string>>().default({}),

    // 用户状态
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    idxRecipient: index('idx_notif_recipient').on(t.recipientUserId, t.createdAt),
    idxRecipientUnread: index('idx_notif_unread').on(t.recipientUserId, t.readAt),
    idxLevel: index('idx_notif_level').on(t.level),
    idxRef: index('idx_notif_ref').on(t.refType, t.refId),
  }),
);

export const userPushPreferences = pgTable(
  'user_push_preferences',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

    // 各类别开关
    chatMsgEnabled: integer('chat_msg_enabled').default(1).notNull(),
    orderStatusEnabled: integer('order_status_enabled').default(1).notNull(),
    dispatchOfferEnabled: integer('dispatch_offer_enabled').default(1).notNull(),
    reviewEnabled: integer('review_enabled').default(1).notNull(),
    withdrawEnabled: integer('withdraw_enabled').default(1).notNull(),
    promoEnabled: integer('promo_enabled').default(0).notNull(),

    // 静默时段（用户本地时间）
    quietHoursStart: text('quiet_hours_start'), // HH:MM
    quietHoursEnd: text('quiet_hours_end'),

    // 模糊化通知（隐私模式开启时）
    obfuscatePreviews: integer('obfuscate_previews').default(0).notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    endpoint: text('endpoint').notNull().unique(),
    p256dhKey: text('p256dh_key').notNull(),
    authKey: text('auth_key').notNull(),
    userAgent: text('user_agent'),

    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    failureCount: integer('failure_count').default(0).notNull(),
    isActive: integer('is_active').default(1).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_push_sub_user').on(t.userId, t.isActive),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type UserPushPreference = typeof userPushPreferences.$inferSelect;
export type WebPushSubscription = typeof webPushSubscriptions.$inferSelect;
