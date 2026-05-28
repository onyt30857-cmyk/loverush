/**
 * M03 v2 · 客户 AI 助理 home 仪表盘的对话历史会话表
 *
 * 用于 GET /assistant/home 返回最近 3 条 history 列表(模式 C · F03-Home3)。
 *
 * 设计:
 * - 每条 row = 一次对话会话(由前端进入对话页生成)
 * - preview 是该会话第一条用户消息的预览(便于 home 显示)
 * - turns_count 累计对话轮次
 * - updated_at 用于按时间排序
 *
 * RLS: 启用见 migration 0007 · 由 app.user_id setting 强约束
 */

import { pgTable, uuid, text, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const customerAssistantSessions = pgTable(
  'customer_assistant_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 第一条用户消息预览(用于 home 显示) */
    preview: text('preview'),

    /** 累计对话轮次 · 每轮 user+assistant 一对 */
    turnsCount: integer('turns_count').default(0).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUserUpdated: index('idx_assistant_sessions_user_updated').on(t.userId, t.updatedAt),
  }),
);

export type CustomerAssistantSession = typeof customerAssistantSessions.$inferSelect;
export type NewCustomerAssistantSession = typeof customerAssistantSessions.$inferInsert;
