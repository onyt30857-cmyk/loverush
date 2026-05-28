-- 0006 · M03 助理记忆 · 回滚
BEGIN;

DROP TABLE IF EXISTS customer_outreach_state;
DROP TABLE IF EXISTS customer_interest_clusters;
DROP TABLE IF EXISTS customer_reference_memory;
DROP TABLE IF EXISTS customer_saved_memory;

COMMIT;
