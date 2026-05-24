-- Rollback for 0002_admin_audit_log.sql
-- ⚠️ Data loss risk: drops admin_audit_log entirely (~ all historical audit records lost).
--   Make sure to dump first:
--     pg_dump $DATABASE_URL -t admin_audit_log > admin_audit_log.dump.sql

BEGIN;

DROP INDEX IF EXISTS idx_audit_action_created;
DROP INDEX IF EXISTS idx_audit_target;
DROP INDEX IF EXISTS idx_audit_actor_created;
DROP TABLE IF EXISTS admin_audit_log;

COMMIT;
