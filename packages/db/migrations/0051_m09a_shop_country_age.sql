-- M09a 橱窗带货：补国家维度 / 退款 / 年龄列（三表已存在，仅加列）
ALTER TABLE shop_items  ADD COLUMN IF NOT EXISTS country_codes text[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS commission_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS adult_confirmed_at timestamptz;
