-- Rollback for 0017_m06_default_enable.sql
-- 恢复 default 0(新技师不再默认开启)。
-- ⚠️ 不自动回滚已开启技师的数据(不可知哪些是本迁移开的、哪些是技师自己开的)。
--    若确需把全部技师关回:手动执行 UPDATE therapists SET ai_alter_enabled = 0;

BEGIN;

ALTER TABLE therapists ALTER COLUMN ai_alter_enabled SET DEFAULT 0;

COMMIT;
