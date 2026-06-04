/**
 * M18 撩拨发图 · 聊天素材库
 * chat_media：技师专为聊天撩拨准备的图(分级,不挂公开主页)
 * chat_media_sends：发送记录(防重核心,一图对一客户只发一次)
 */
import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const chatMedia = pgTable('chat_media', {
  id: uuid('id').defaultRandom().primaryKey(),
  therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  tier: text('tier').notNull().default('free'),
  pricePoints: integer('price_points').notNull().default(0),
  intimacyMin: integer('intimacy_min').notNull().default(0),
  weight: integer('weight').notNull().default(1),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  idxTherapist: index('idx_chat_media_therapist').on(t.therapistUserId, t.isActive),
}));

export const chatMediaSends = pgTable('chat_media_sends', {
  id: uuid('id').defaultRandom().primaryKey(),
  therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => chatMedia.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqSend: uniqueIndex('uidx_chat_media_send').on(t.therapistUserId, t.customerId, t.mediaId),
  idxPair: index('idx_chat_media_send_pair').on(t.therapistUserId, t.customerId, t.sentAt),
}));
