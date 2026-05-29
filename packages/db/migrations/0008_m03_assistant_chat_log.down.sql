-- 0008 · M03 Admin A1 助理对话日志表 · ROLLBACK
--
-- 应用方式:
--   psql "$DATABASE_URL" -f packages/db/migrations/0008_m03_assistant_chat_log.down.sql

BEGIN;

DROP TABLE IF EXISTS assistant_chat_log;

COMMIT;
