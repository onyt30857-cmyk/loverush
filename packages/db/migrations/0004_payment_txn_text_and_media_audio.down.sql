-- Rollback for 0004_payment_txn_text_and_media_audio.sql
-- ⚠️ Data loss risk: 已存的非 UUID payment_txn_id（如 Stripe pi_xxx）将无法回退保留
-- 注意：DROP enum value 在 PostgreSQL 不支持，'audio' 值只能保留（无害）

BEGIN;

-- text → uuid · 仅当所有现有值都符合 UUID 格式才能成功
-- 生产环境若已有 Stripe ID，此 down 会失败 · 需先迁移数据：
--   UPDATE orders SET payment_txn_id = gen_random_uuid()::text WHERE payment_txn_id !~ '^[0-9a-f]{8}-...';
ALTER TABLE orders
  ALTER COLUMN payment_txn_id TYPE uuid
  USING payment_txn_id::uuid;

COMMIT;

-- 'audio' enum 值无法 DROP（PostgreSQL 限制）· down 后该值仍存在 · 不影响功能
