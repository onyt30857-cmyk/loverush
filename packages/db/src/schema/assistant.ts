/**
 * AI 分身画像（客户端）· 对应 PRD §4.3
 *
 * - customer_assistant_profile：客户的 AI 助理画像（个性化 prompt + 风格）
 * - customer_session_preferences：客户在当前会话中的状态（情绪 / 意图）
 * - customer_behavior_profile：长期行为画像（稳/探/混合 三种 mode）
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { behaviorModeEnum } from './enums';

/** AI 助理 / 分身画像 */
export const customerAssistantProfile = pgTable(
  'customer_assistant_profile',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),

    // 助理身份（客户可命名）
    assistantName: text('assistant_name').default('小助理').notNull(),
    assistantAvatar: text('assistant_avatar'),

    // 个性化（用于 prompt 构建）
    personalityProfile: jsonb('personality_profile').$type<{
      tone: string; // 温柔 / 直接 / 调皮 / 冷静
      warmth: number; // 0-100
      proactivity: number; // 0-100
      humor: number; // 0-100
    }>(),

    // 系统 prompt 模板（个性化注入）
    systemPromptOverride: text('system_prompt_override'),

    // 记忆窗口
    memoryWindowDays: integer('memory_window_days').default(30).notNull(),
    longTermMemory: jsonb('long_term_memory').$type<Record<string, unknown>>().default({}),

    // 设置
    proactiveGreetingEnabled: integer('proactive_greeting_enabled').default(1).notNull(),
    learningEnabled: integer('learning_enabled').default(1).notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_assist_prof_user').on(t.userId),
  }),
);

/** 会话级状态（当前对话上下文 / 情绪 / 意图） */
export const customerSessionPreferences = pgTable(
  'customer_session_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull(),

    // 当前情绪 / 意图
    currentMood: text('current_mood'), // happy / anxious / tired / horny ...
    currentIntent: text('current_intent'), // browse / book / chat / vent
    intentConfidence: integer('intent_confidence').default(50).notNull(),

    // 对话上下文摘要（节省 token）
    contextSummary: text('context_summary'),
    lastNTurns: jsonb('last_n_turns').$type<Array<{ role: string; content: string; ts: string }>>(),

    // 时效
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUserSession: index('idx_sess_pref_user_sess').on(t.userId, t.sessionToken),
    idxExpires: index('idx_sess_pref_expires').on(t.expiresAt),
  }),
);

/** 长期行为画像（稳/探/混合 mode） */
export const customerBehaviorProfile = pgTable(
  'customer_behavior_profile',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),

    // 行为模式
    behaviorMode: behaviorModeEnum('behavior_mode').default('mixed').notNull(),
    modeConfidence: integer('mode_confidence').default(50).notNull(),

    // 统计
    totalOrders: integer('total_orders').default(0).notNull(),
    uniqueTherapists: integer('unique_therapists').default(0).notNull(),
    repeatRate: integer('repeat_rate').default(0).notNull(), // 0-100
    avgOrderIntervalDays: integer('avg_order_interval_days').default(0).notNull(),

    // 画像指标
    avgOrderValuePoints: integer('avg_order_value_points').default(0).notNull(),
    tipRate: integer('tip_rate').default(0).notNull(),
    disputeCount: integer('dispute_count').default(0).notNull(),

    // 特征向量（pgvector，后续启用）
    embeddingJson: jsonb('embedding_meta').$type<Record<string, unknown>>(),

    lastComputedAt: timestamp('last_computed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_behav_user').on(t.userId),
    idxMode: index('idx_behav_mode').on(t.behaviorMode),
  }),
);

export type CustomerAssistantProfile = typeof customerAssistantProfile.$inferSelect;
export type NewCustomerAssistantProfile = typeof customerAssistantProfile.$inferInsert;
export type CustomerSessionPreference = typeof customerSessionPreferences.$inferSelect;
export type CustomerBehaviorProfile = typeof customerBehaviorProfile.$inferSelect;
