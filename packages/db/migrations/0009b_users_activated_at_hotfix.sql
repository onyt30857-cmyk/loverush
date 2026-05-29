-- 0009b · 紧急 hotfix · 仅加列 + 索引(无 backfill)
--
-- 用途:生产 register E9999 修复(activated_at 列缺失)
-- 0009 完整版含 backfill UNION 多表 · 任一表缺就 rollback
-- 0009b 只加列 + 索引 · 100% 安全 · 等所有表对齐后再跑 0009 backfill 部分
--
-- 应用:
--   psql "$DATABASE_URL" -f packages/db/migrations/0009b_users_activated_at_hotfix.sql

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_activated_at ON users (activated_at);

COMMIT;
