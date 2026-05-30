-- 一次性脚本 · 清除所有客户和技师账户 + 关联数据
--
-- ⚠️ 危险操作 · 不可撤销
-- 触发时机:产品从 mnemonic 模式切换到账号名+密码模式时清旧账户
--
-- 应用方式:
--   psql "$DATABASE_URL" -f packages/db/migrations/9999_reset_all_accounts.sql
--
-- 清单(CASCADE 自动级联,这里显式声明顺序以防 RESTRICT 外键):
--   - sessions / refresh tokens
--   - encryption_keys
--   - device_fingerprints
--   - privacy_settings
--   - points_account / points_transaction
--   - therapists / therapist_earnings / withdrawals
--   - conversations / messages
--   - orders
--   - reviews
--   - 用户表本身
--
-- admin / agent / ops 等角色用户 是否保留?默认 **保留**(如果通过 user_roles 表标识)
-- 只删 user_type='customer' OR 'therapist' 的

BEGIN;

-- 1. 算一下要删多少
DO $$
DECLARE
  cnt_total int;
  cnt_admin int;
BEGIN
  SELECT count(*) INTO cnt_total FROM users WHERE user_type IN ('customer', 'therapist');
  SELECT count(*) INTO cnt_admin FROM users
    WHERE user_type IN ('customer', 'therapist')
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL);
  RAISE NOTICE '将删除 % 个客户/技师账户(其中 % 个有 admin 角色,会保留)', cnt_total, cnt_admin;
END $$;

-- 2. 真删 · 只删纯客户/技师,保留有 admin/cs/auditor 等角色的账户
WITH targets AS (
  SELECT id FROM users
   WHERE user_type IN ('customer', 'therapist')
     AND NOT EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL
     )
)
DELETE FROM users WHERE id IN (SELECT id FROM targets);
-- CASCADE 会自动清:
--   - sessions, encryption_keys, points_account, therapists,
--     conversations, messages, customer_assistant_*, dispatch_offers,
--     media_assets, points_transaction(RESTRICT 会报错,见下)
--
-- 注:某些表是 RESTRICT(orders, points_transaction, withdrawals, tips)
-- 这些表如果有数据,DELETE 会失败。需要先单独清:

-- 提前清 RESTRICT 表
DELETE FROM points_transaction WHERE user_id IN (
  SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
);
DELETE FROM orders WHERE customer_id IN (
  SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
) OR therapist_user_id IN (
  SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
);
DELETE FROM withdrawals WHERE therapist_user_id IN (
  SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
);
DELETE FROM tips WHERE customer_id IN (
  SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
) OR therapist_id IN (
  SELECT t.id FROM therapists t
   JOIN users u ON u.id = t.user_id
   WHERE u.user_type IN ('customer', 'therapist')
);

-- 重跑真删
DELETE FROM users
 WHERE user_type IN ('customer', 'therapist')
   AND NOT EXISTS (
     SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL
   );

-- 3. 重置邀请码使用计数(避免被旧用户消耗了的码不能再用)
UPDATE invite_codes SET used_count = 0 WHERE disabled_at IS NULL;

-- 4. 显示结果
DO $$
DECLARE
  cnt_remaining int;
BEGIN
  SELECT count(*) INTO cnt_remaining FROM users;
  RAISE NOTICE '✓ 清理完成 · 剩余 % 个账户(管理员/客服等保留)', cnt_remaining;
END $$;

COMMIT;
