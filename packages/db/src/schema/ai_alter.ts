/**
 * AI 分身日志 · M06 v2
 *
 * - ai_alter_messages：每条由 AI 分身代发的消息日志（与 messages.id 关联）
 * - ai_alter_redline_logs：红线检测命中（人工/AI 自动 BLOCK / REWRITE）
 * - simhash_messages：SimHash 索引，做反重复（汉明距离 ≤ 12 视为相似）
 *
 * 注：v5 政策客户端 ZERO AI 标识，这里所有数据仅服务端 / 管理后台可见。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { messages, conversations } from './chat';
import { therapists } from './therapists';

/** AI 分身代发消息日志 */
export const aiAlterMessages = pgTable(
  'ai_alter_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistId: uuid('therapist_id').references(() => therapists.id, { onDelete: 'cascade' }),

    // 触发场景
    scenario: text('scenario').notNull(), // greeting / price_inquiry / book_intent / smalltalk / sensitive_redirect / ...

    // 生成
    promptVersion: text('prompt_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsdMicros: integer('cost_usd_micros'), // USD 微元（1 USD = 1,000,000）

    // 质量
    simhash: bigint('simhash', { mode: 'number' }), // 64-bit hamming compare
    redlineFlags: text('redline_flags').array(),

    // 上下文快照
    contextSnapshot: jsonb('context_snapshot').$type<Record<string, unknown>>().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapist: index('idx_ai_alter_therapist').on(t.therapistUserId, t.createdAt),
    idxScenario: index('idx_ai_alter_scenario').on(t.scenario),
    idxRedline: index('idx_ai_alter_redline').on(t.redlineFlags),
  }),
);

/** 红线检测命中日志 */
export const aiAlterRedlineLogs = pgTable(
  'ai_alter_redline_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 检测时机
    stage: text('stage').notNull(), // pre_send / pre_save / post_send
    flag: text('flag').notNull(), // contact_off_platform / payment_off_platform / fake_memory / minor / illegal

    // 文本快照
    candidateText: text('candidate_text'),
    contextText: text('context_text'),

    // 处置
    action: text('action').notNull(), // block / rewrite / warn / pass
    rewrittenText: text('rewritten_text'),
    confidence: integer('confidence').default(80).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapist: index('idx_redline_therapist').on(t.therapistUserId, t.createdAt),
    idxFlag: index('idx_redline_flag').on(t.flag),
  }),
);

/** SimHash 索引（反重复） */
export const simhashIndex = pgTable(
  'simhash_index',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    simhash: bigint('simhash', { mode: 'number' }).notNull(),
    sampleText: text('sample_text'),
    scenario: text('scenario'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapistHash: index('idx_simhash_therapist').on(t.therapistUserId, t.simhash),
  }),
);

/**
 * 待回复调度表（拟人回复时机）·一会话一行
 *
 * 客户发消息后不立即生成回复，而是登记"计划在 scheduledAt 回"。客户连发多条 →
 * 同一行 scheduledAt 不断往后推 = 天然 debounce（等他打完只回最后一次）。
 * 高频 tick 扫 scheduledAt <= now 的行 → 触发分身回复 → 删行。
 */
export const aiAlterPendingReply = pgTable(
  'ai_alter_pending_reply',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    customerLocale: text('customer_locale'),
    lastCustomerMsgAt: timestamp('last_customer_msg_at', { withTimezone: true }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(), // 到点才回
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqConversation: uniqueIndex('uq_pending_reply_conversation').on(t.conversationId), // 一会话一行 → upsert debounce
    idxScheduled: index('idx_pending_reply_scheduled').on(t.scheduledAt), // tick 按到点扫
  }),
);

export type AiAlterMessage = typeof aiAlterMessages.$inferSelect;
export type NewAiAlterMessage = typeof aiAlterMessages.$inferInsert;
export type AiAlterRedlineLog = typeof aiAlterRedlineLogs.$inferSelect;
export type SimhashIndexRow = typeof simhashIndex.$inferSelect;
export type AiAlterPendingReply = typeof aiAlterPendingReply.$inferSelect;
