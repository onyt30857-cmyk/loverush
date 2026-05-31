-- Rollback for 0018_m06_proactive.sql
-- ⚠️ Data loss: drops last_proactive_at（频率帽时间戳）· 回滚后唤回频率帽失效

BEGIN;

DROP INDEX IF EXISTS idx_relationship_proactive;
ALTER TABLE customer_relationship_profile DROP COLUMN IF EXISTS last_proactive_at;

COMMIT;
