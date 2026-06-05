/**
 * 陪聊付费服务 · 每日免费额度 + 陪聊时段(按时长·纯倒计时)
 *
 * chat_quota_usage：(客户×技师×日期) 每日免费分身回复计数。用完 → 软墙。
 * chat_session：陪聊时段。买了即激活 startAt=now、expireAt=now+时长,期间不限条畅聊。
 */
import { pgTable, uuid, text, integer, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';

export const chatQuotaUsage = pgTable(
  'chat_quota_usage',
  {
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    usageDate: text('usage_date').notNull(), // YYYY-MM-DD (UTC v1)
    usedCount: integer('used_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.customerId, t.therapistUserId, t.usageDate] }),
  }),
);

export const chatSession = pgTable(
  'chat_session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    durationMinutes: integer('duration_minutes').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    expireAt: timestamp('expire_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxActive: index('idx_chat_session_active').on(t.customerId, t.therapistUserId, t.expireAt),
  }),
);
