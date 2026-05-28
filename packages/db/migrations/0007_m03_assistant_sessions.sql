-- 0007 · M03 v2 客户 AI 助理 home 仪表盘的对话会话表 + RLS
--
-- 来源:packages/db/src/schema/assistant_session.ts
-- 幂等:DO + EXCEPTION + IF NOT EXISTS,可重复执行
-- 安全:仅 CREATE,无 DROP/ALTER/数据写入
--
-- 应用方式:
--   psql "$DATABASE_URL" -f packages/db/migrations/0007_m03_assistant_sessions.sql
--
-- 应用后验证:
--   SELECT to_regclass('public.customer_assistant_sessions');
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_assistant_sessions';

BEGIN;

CREATE TABLE IF NOT EXISTS customer_assistant_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preview       text,
  turns_count   integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_sessions_user_updated
  ON customer_assistant_sessions (user_id, updated_at DESC);

ALTER TABLE customer_assistant_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY cas_isolation ON customer_assistant_sessions
    USING (user_id = current_setting('app.user_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 说明:RLS 默认对 superuser/owner 不生效,服务端用专用 role 连接并
-- SET LOCAL app.user_id = '<uuid>' 注入 user_id

COMMIT;
