-- Migration · Phase 33 · 修两个生产 bug
--
-- 1. orders.payment_txn_id: uuid → text · Stripe/Adyen ID 不是 UUID（pi_xxx / psp_xxx）
-- 2. media_type enum 加 'audio' · 之前 voice_intro 写 enum 时 fallback 到非法值导致 500
--
-- 应用：psql $DATABASE_URL -f migrations/0004_payment_txn_text_and_media_audio.sql

-- ALTER TYPE ADD VALUE 不能在事务里，所以放在 BEGIN/COMMIT 之外
ALTER TYPE media_type ADD VALUE IF NOT EXISTS 'audio';

BEGIN;

-- payment_txn_id uuid → text
-- 使用 USING 子句保留现有数据（uuid::text 是 PG 内置 cast）
ALTER TABLE orders
  ALTER COLUMN payment_txn_id TYPE text
  USING payment_txn_id::text;

COMMENT ON COLUMN orders.payment_txn_id IS 'Payment provider transaction ID (Stripe pi_xxx / Adyen psp_xxx / etc) — not necessarily UUID';

COMMIT;
