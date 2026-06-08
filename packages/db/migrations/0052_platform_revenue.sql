-- 0052 平台收入流水 platform_revenue
-- 各抽成点差额统一入账(此前差额蒸发不可对账);(source, ref_id) 唯一做幂等。
CREATE TABLE IF NOT EXISTS platform_revenue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  amount integer NOT NULL,
  ref_id text NOT NULL,
  customer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  therapist_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_revenue_source_ref ON platform_revenue (source, ref_id);
CREATE INDEX IF NOT EXISTS idx_platform_revenue_created ON platform_revenue (created_at);
CREATE INDEX IF NOT EXISTS idx_platform_revenue_source ON platform_revenue (source, created_at);
