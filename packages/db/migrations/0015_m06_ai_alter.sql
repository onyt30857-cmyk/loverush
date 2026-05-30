-- 0015 · M06 AI 分身 · ai_alter_messages + ai_alter_redline_logs + simhash_index + therapists 2 列
--
-- 用途:技师 AI 分身代发日志 / 红线检测日志 / SimHash 反重复索引 + 技师分身开关与人格配置
-- 来源:packages/db/src/schema/ai_alter.ts + therapists.ts(ai_alter_enabled / ai_alter_personality)
--       已 in code 提交但生产库缺表 → maybeReplyAsAlter / configureAiAlter 全崩(同 0005 教训)
-- 幂等:CREATE TABLE/COLUMN/INDEX IF NOT EXISTS · 可重复执行
-- 安全:仅 CREATE + ALTER ADD · 无 DROP · 无数据写入。失败自动 ROLLBACK(BEGIN/COMMIT 包裹)
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0015_m06_ai_alter.sql
--
-- 验证:
--   SELECT to_regclass('public.ai_alter_messages');
--   SELECT to_regclass('public.ai_alter_redline_logs');
--   SELECT to_regclass('public.simhash_index');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='therapists' AND column_name IN ('ai_alter_enabled','ai_alter_personality');

BEGIN;

-- ─────────────────── 1. ai_alter_messages · AI 分身代发消息日志 ───────────────────

CREATE TABLE IF NOT EXISTS ai_alter_messages (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id         uuid         NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  therapist_user_id  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id       uuid         REFERENCES therapists(id) ON DELETE CASCADE,
  scenario           text         NOT NULL,
  prompt_version     text         NOT NULL,
  provider           text         NOT NULL,
  model              text         NOT NULL,
  input_tokens       integer,
  output_tokens      integer,
  cost_usd_micros    integer,
  simhash            bigint,
  redline_flags      text[],
  context_snapshot   jsonb        DEFAULT '{}'::jsonb,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_alter_therapist ON ai_alter_messages (therapist_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_alter_scenario  ON ai_alter_messages (scenario);
CREATE INDEX IF NOT EXISTS idx_ai_alter_redline   ON ai_alter_messages (redline_flags);

-- ─────────────────── 2. ai_alter_redline_logs · 红线检测命中日志 ───────────────────

CREATE TABLE IF NOT EXISTS ai_alter_redline_logs (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_user_id  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage              text         NOT NULL,
  flag               text         NOT NULL,
  candidate_text     text,
  context_text       text,
  action             text         NOT NULL,
  rewritten_text     text,
  confidence         integer      NOT NULL DEFAULT 80,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redline_therapist ON ai_alter_redline_logs (therapist_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_redline_flag      ON ai_alter_redline_logs (flag);

-- ─────────────────── 3. simhash_index · SimHash 反重复索引 ───────────────────

CREATE TABLE IF NOT EXISTS simhash_index (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_user_id  uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  simhash            bigint       NOT NULL,
  sample_text        text,
  scenario           text,
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simhash_therapist ON simhash_index (therapist_user_id, simhash);

-- ─────────────────── 4. therapists 加 AI 分身配置列 ───────────────────

ALTER TABLE therapists ADD COLUMN IF NOT EXISTS ai_alter_enabled     integer NOT NULL DEFAULT 0;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS ai_alter_personality jsonb;

COMMIT;
