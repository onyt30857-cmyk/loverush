/**
 * AI 助理对话日志 · M03 Admin 治理后台 A1 会话回放专用
 *
 * 写入时机:apps/api/src/services/assistant/chat.ts 每次 chat 完成后异步插入
 *           (fireAndForget,不阻塞主链路)
 *
 * 读取场景:
 *   - admin /ai/assistant/sessions 列表(按客户 / 时间 / cost 筛选)
 *   - admin /ai/assistant/sessions/[sessionId] 详情(turn-by-turn 回放)
 *   - 后续 A2 Bad case 集从这里筛 filterAttempts >= 3 的入库
 *   - 后续 A3 Filter 误杀回看从 filterReasons 钻取
 *
 * 与现有表关系:
 *   - sessionId 对应 customer_assistant_sessions.id(已存在,记 home 仪表盘)
 *   - userId 对应 users.id(级联删除)
 *   - 不引入 message 表关联(assistant 对话目前不写 messages 表)
 *
 * 保留期:90 天(后续 cron 归档)
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index, bigint } from 'drizzle-orm/pg-core';
import { users } from './users';
import { customerAssistantSessions } from './assistant_session';

export const assistantChatLog = pgTable(
  'assistant_chat_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // ── 关联
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => customerAssistantSessions.id, { onDelete: 'set null' }),
    turnIdx: integer('turn_idx').notNull(), // 在本 session 内的第几轮(从 0 起)

    // ── 输入
    userInput: text('user_input').notNull(),      // 脱敏后的 user 原文
    userInputRaw: text('user_input_raw'),         // 脱敏前(仅 cs+auditor 可见,ops 拿不到)

    // ── 状态机推断结果
    scenario: text('scenario').notNull(),         // casual / selection / after_service / complaint / emergency
    jokeLevel: integer('joke_level').notNull(),   // 0-3
    seriousMode: integer('serious_mode').notNull(), // 0/1

    // ── 注入的人物配置
    locale: text('locale').notNull(),             // zh / en / th / vi / ...
    voiceVersion: text('voice_version'),          // 当前生效的 voice 版本号(B1 上线后填)
    fewshotIds: jsonb('fewshot_ids').$type<string[]>(), // 选中的 few-shot 样本 id 列表(B2 上线后填)

    // ── system prompt(完整存,便于 admin 详情查看)
    systemPrompt: text('system_prompt').notNull(),

    // ── 注入的 memory 摘要(snippet 字符串,不存原始 L3-L5)
    memorySnippet: text('memory_snippet'),

    // ── LLM 调用
    llmProvider: text('llm_provider'),            // anthropic / openai / gemini
    llmModel: text('llm_model'),                  // claude-haiku-4-5 / gpt-4.1 等
    llmTier: text('llm_tier').notNull().default('T1'), // T1 / T2 / T3
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsdMicros: bigint('cost_usd_micros', { mode: 'number' }), // 1 USD = 1,000,000

    // ── 反 slop filter
    filterAttempts: integer('filter_attempts').notNull().default(1),
    filterFinalSoftScore: integer('filter_final_soft_score'),
    filterFinalHardHits: jsonb('filter_final_hard_hits').$type<string[]>(),
    llmRawOutput: text('llm_raw_output'),         // 最后一次 attempt 的 raw(便于看 filter 改写了啥)

    // ── 最终给客户的内容
    finalContent: text('final_content').notNull(),

    // ── 时延
    latencyMs: integer('latency_ms').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // 按用户 + 时间倒序查(列表分页主索引)
    userIdCreatedAtIdx: index('assistant_chat_log_user_created_idx').on(t.userId, t.createdAt.desc()),
    // 按 session 查(详情回放主索引)
    sessionIdTurnIdx: index('assistant_chat_log_session_turn_idx').on(t.sessionId, t.turnIdx),
    // 按 filter attempts 筛 Bad case
    filterAttemptsIdx: index('assistant_chat_log_filter_idx').on(t.filterAttempts, t.createdAt.desc()),
    // 按 cost 排序(找烧钱大户)
    costIdx: index('assistant_chat_log_cost_idx').on(t.costUsdMicros, t.createdAt.desc()),
  }),
);
