-- Rollback for 0015_m06_ai_alter.sql
-- ⚠️ Data loss risk: drops ai_alter_messages / ai_alter_redline_logs / simhash_index
--    + therapists.ai_alter_enabled / ai_alter_personality — 回滚前先 pg_dump 备份

BEGIN;

DROP INDEX IF EXISTS idx_ai_alter_therapist;
DROP INDEX IF EXISTS idx_ai_alter_scenario;
DROP INDEX IF EXISTS idx_ai_alter_redline;
DROP INDEX IF EXISTS idx_redline_therapist;
DROP INDEX IF EXISTS idx_redline_flag;
DROP INDEX IF EXISTS idx_simhash_therapist;

DROP TABLE IF EXISTS ai_alter_messages     CASCADE;
DROP TABLE IF EXISTS ai_alter_redline_logs CASCADE;
DROP TABLE IF EXISTS simhash_index         CASCADE;

ALTER TABLE therapists DROP COLUMN IF EXISTS ai_alter_enabled;
ALTER TABLE therapists DROP COLUMN IF EXISTS ai_alter_personality;

COMMIT;
