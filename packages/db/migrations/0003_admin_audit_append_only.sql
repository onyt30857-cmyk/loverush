-- Migration · Phase 25 · admin_audit_log 强制 append-only
-- 应用：psql $DATABASE_URL -f migrations/0003_admin_audit_append_only.sql
--
-- 三层防御：
--   1. 应用层：服务只调 INSERT，不暴露 UPDATE / DELETE 端点
--   2. DB 权限：建议 GRANT INSERT,SELECT ON admin_audit_log TO loverush_app（不给 U/D）
--   3. DB 触发器（本迁移）：即使权限配错，触发器仍然拒绝 UPDATE / DELETE / TRUNCATE
--
-- 例外：超级用户（postgres）仍可绕过触发器做手动维护，但留 NOTICE。

BEGIN;

CREATE OR REPLACE FUNCTION admin_audit_log_block_modify()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'admin_audit_log is append-only (UPDATE forbidden); use a new INSERT to correct mistakes';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin_audit_log is append-only (DELETE forbidden); retention should be policy-driven, not by DELETE';
  ELSIF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'admin_audit_log is append-only (TRUNCATE forbidden)';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- UPDATE / DELETE 用 BEFORE 行级
DROP TRIGGER IF EXISTS trg_admin_audit_block_modify ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_block_modify
BEFORE UPDATE OR DELETE ON admin_audit_log
FOR EACH ROW EXECUTE FUNCTION admin_audit_log_block_modify();

-- TRUNCATE 用 BEFORE 语句级
DROP TRIGGER IF EXISTS trg_admin_audit_block_truncate ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_block_truncate
BEFORE TRUNCATE ON admin_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_block_modify();

COMMIT;
