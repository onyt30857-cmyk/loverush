/**
 * Per-user 会话已读位置 · M05 Phase 1
 *
 * 修正:旧设计用 messages.readAt 全表单字段 · 无法区分 customer/therapist 哪边读了
 * 新设计:每个(conversationId, userId)一行 · 存 lastReadMessageId + lastReadAt
 *        未读数 = SELECT COUNT(*) FROM messages
 *                  WHERE conv=X AND sent_at > lastReadAt AND sender != self
 */

import { pgTable, uuid, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { conversations } from './chat';
import { users } from './users';

export const conversationReadState = pgTable(
  'conversation_read_state',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conversationId, t.userId] }),
    idxUser: index('idx_conv_read_user').on(t.userId, t.lastReadAt),
  }),
);

export type ConversationReadState = typeof conversationReadState.$inferSelect;
export type NewConversationReadState = typeof conversationReadState.$inferInsert;
