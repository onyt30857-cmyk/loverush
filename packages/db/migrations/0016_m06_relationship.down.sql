-- Rollback for 0016_m06_relationship.sql
-- ⚠️ Data loss risk: drops customer_relationship_profile + relationship_tier enum
--    relationship_tier 也被 therapists.cooling 之外的画像逻辑引用 · 回滚前先 pg_dump 备份

BEGIN;

DROP INDEX IF EXISTS uidx_relationship_pair;
DROP INDEX IF EXISTS idx_relationship_customer;
DROP INDEX IF EXISTS idx_relationship_therapist;
DROP INDEX IF EXISTS idx_relationship_last_order;

DROP TABLE IF EXISTS customer_relationship_profile CASCADE;

DROP TYPE IF EXISTS relationship_tier;

COMMIT;
