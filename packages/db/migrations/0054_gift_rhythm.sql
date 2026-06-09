-- M06 礼物索要节奏 P0 · relationship 加 2 列
-- 幂等 ADD COLUMN IF NOT EXISTS · 先生产跑再 push

ALTER TABLE customer_relationship_profile
  ADD COLUMN IF NOT EXISTS last_gift_received_at timestamptz;

ALTER TABLE customer_relationship_profile
  ADD COLUMN IF NOT EXISTS last_gift_hint_kind text;
