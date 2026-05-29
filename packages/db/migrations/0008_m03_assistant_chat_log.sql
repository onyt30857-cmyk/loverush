-- 0008 · M03 Admin A1 会话回放 · 助理对话日志表
--
-- 用途:每次 /assistant/chat 调用后异步写入一条,供 admin 后台
--       /ai/assistant/sessions 列表 + [sessionId] 详情回放使用。
--       同时为 A2 Bad case 集、A3 Filter 误杀回看提供数据底座。
--
-- 来源:packages/db/src/schema/assistant_chat_log.ts
-- 幂等:DO + EXCEPTION + IF NOT EXISTS,可重复执行
-- 安全:仅 CREATE,无 DROP/ALTER/数据写入
--
-- 应用方式:
--   psql "$DATABASE_URL" -f packages/db/migrations/0008_m03_assistant_chat_log.sql
--
-- 应用后验证:
--   SELECT to_regclass('public.assistant_chat_log');
--   SELECT indexname FROM pg_indexes WHERE tablename = 'assistant_chat_log';

BEGIN;

CREATE TABLE IF NOT EXISTS assistant_chat_log (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── 关联
  user_id                     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id                  uuid        REFERENCES customer_assistant_sessions(id) ON DELETE SET NULL,
  turn_idx                    integer     NOT NULL,

  -- ── 输入
  user_input                  text        NOT NULL,
  user_input_raw              text,

  -- ── 状态机推断结果
  scenario                    text        NOT NULL,
  joke_level                  integer     NOT NULL,
  serious_mode                integer     NOT NULL,

  -- ── 注入的人物配置
  locale                      text        NOT NULL,
  voice_version               text,
  fewshot_ids                 jsonb,

  -- ── system prompt
  system_prompt               text        NOT NULL,
  memory_snippet              text,

  -- ── LLM 调用
  llm_provider                text,
  llm_model                   text,
  llm_tier                    text        NOT NULL DEFAULT 'T1',
  input_tokens                integer,
  output_tokens               integer,
  cost_usd_micros             bigint,

  -- ── 反 slop filter
  filter_attempts             integer     NOT NULL DEFAULT 1,
  filter_final_soft_score     integer,
  filter_final_hard_hits      jsonb,
  llm_raw_output              text,

  -- ── 最终给客户的内容
  final_content               text        NOT NULL,

  -- ── 时延
  latency_ms                  integer     NOT NULL,

  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_chat_log_user_created_idx
  ON assistant_chat_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assistant_chat_log_session_turn_idx
  ON assistant_chat_log (session_id, turn_idx);

CREATE INDEX IF NOT EXISTS assistant_chat_log_filter_idx
  ON assistant_chat_log (filter_attempts, created_at DESC);

CREATE INDEX IF NOT EXISTS assistant_chat_log_cost_idx
  ON assistant_chat_log (cost_usd_micros, created_at DESC);

-- RLS:服务端写入用 service role(绕过 RLS);
-- admin 读取走专用 admin role 不经 RLS,而是在 service 层做权限隔离。
-- 不强加 RLS 避免日志写入被错配 user_id 阻塞。

COMMIT;
