-- 0027 业务模型重构 · 法币定价 + 心动金担保 + 线下交付
-- 旧"积分全款"模式保留向后兼容 · 新 currency_code 必填走新模式

-- ──────────────── 新表 1 · 法币字典 ────────────────
CREATE TABLE IF NOT EXISTS currencies (
  code text PRIMARY KEY,
  symbol text NOT NULL,
  name_zh text NOT NULL,
  name_en text NOT NULL,
  decimals integer NOT NULL DEFAULT 2,
  display_order integer NOT NULL DEFAULT 100,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, symbol, name_zh, name_en, decimals, display_order) VALUES
  ('THB', '฿', '泰铢', 'Thai Baht', 2, 10),
  ('SGD', 'S$', '新加坡元', 'Singapore Dollar', 2, 20),
  ('MYR', 'RM', '马来西亚林吉特', 'Malaysian Ringgit', 2, 30),
  ('IDR', 'Rp', '印尼盾', 'Indonesian Rupiah', 0, 40),
  ('USD', '$', '美元', 'US Dollar', 2, 100)
ON CONFLICT (code) DO NOTHING;

-- ──────────────── 新表 2 · 国家默认法币 ────────────────
CREATE TABLE IF NOT EXISTS country_currencies (
  country_code text PRIMARY KEY,
  default_currency text NOT NULL
);

INSERT INTO country_currencies (country_code, default_currency) VALUES
  ('TH', 'THB'),
  ('SG', 'SGD'),
  ('MY', 'MYR'),
  ('ID', 'IDR')
ON CONFLICT (country_code) DO NOTHING;

-- ──────────────── 新表 3 · 汇率(法币→积分) ────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code text NOT NULL,
  points_per_unit numeric(12, 4) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_currency_effective
  ON exchange_rates (currency_code, effective_at DESC);

-- Seed 初始汇率(admin 可改)
INSERT INTO exchange_rates (currency_code, points_per_unit) VALUES
  ('THB', 3.0000),
  ('SGD', 75.0000),
  ('MYR', 22.0000),
  ('IDR', 0.0065),
  ('USD', 100.0000);

-- ──────────────── 新表 4 · 心动金状态机 ────────────────
CREATE TABLE IF NOT EXISTS order_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  therapist_user_id uuid NOT NULL,
  deposit_points bigint NOT NULL,
  status text NOT NULL DEFAULT 'HOLDING',
  -- HOLDING:已冻结 / RELEASED:服务完成退客户
  -- FORFEITED_TO_THERAPIST:客户鸽子 50% 给技师
  -- FORFEITED_TO_PLATFORM:客户鸽子 50% 给平台
  -- REFUNDED:技师鸽子全退客户
  released_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposits_order ON order_deposits (order_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON order_deposits (status);

-- ──────────────── shows 加 4 字段(保留旧 price_points) ────────────────
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS price_fiat numeric(12, 2),
  ADD COLUMN IF NOT EXISTS deposit_ratio_bps integer DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS add_ons_v2 jsonb DEFAULT '[]'::jsonb;

-- ──────────────── orders 加 5 字段 ────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS total_fiat numeric(12, 2),
  ADD COLUMN IF NOT EXISTS deposit_points bigint,
  ADD COLUMN IF NOT EXISTS deposit_status text DEFAULT 'HOLDING',
  ADD COLUMN IF NOT EXISTS offline_paid_at timestamptz;
