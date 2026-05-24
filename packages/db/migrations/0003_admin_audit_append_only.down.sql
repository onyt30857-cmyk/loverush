-- Rollback for 0003_admin_audit_append_only.sql
-- ⚠️ 移除审计表的 append-only 约束。回滚后任何拥有 UPDATE/DELETE 权限的角色
--    都能改写历史审计记录。仅在主动需要做表维护时使用。

BEGIN;

DROP TRIGGER IF EXISTS trg_admin_audit_block_truncate ON admin_audit_log;
DROP TRIGGER IF EXISTS trg_admin_audit_block_modify ON admin_audit_log;
DROP FUNCTION IF EXISTS admin_audit_log_block_modify();

COMMIT;
