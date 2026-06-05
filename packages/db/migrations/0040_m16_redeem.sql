-- M16 P1 · 积分回收(持有人 → 代理 变现)
--
-- 平台冻结担保:持有人积分发起即冻结,代理线下付款后持有人确认,积分释放给代理库存。
-- 流水枚举 AGENT_REDEEM_OUT/AGENT_REDEEM_IN 已在 0038 预加,此处建状态枚举 + 表 + 代理回收率字段。
-- 本迁移可在事务内执行(无 ALTER TYPE ADD VALUE)。

CREATE TYPE point_redeem_status AS ENUM (
  'created', 'agent_accepted', 'agent_paid', 'completed', 'disputed', 'cancelled', 'expired'
);

CREATE TABLE point_redeem_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  points bigint NOT NULL,
  rate_bps integer NOT NULL,
  payout_amount text NOT NULL,
  payout_currency text NOT NULL,
  payout_method_type text NOT NULL,
  payout_method_fields jsonb NOT NULL,
  status point_redeem_status NOT NULL DEFAULT 'created',
  frozen_txn_id uuid,
  transfer_txn_id uuid,
  agent_paid_proof_url text,
  dispute_status text,
  agent_accepted_at timestamptz,
  agent_paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pro_holder ON point_redeem_orders (holder_user_id, created_at);
CREATE INDEX idx_pro_agent_status ON point_redeem_orders (agent_user_id, status);

-- 代理公示回收率 + 累计回收统计
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS total_redeemed_points bigint NOT NULL DEFAULT 0;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS redeem_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS redeem_rate_bps integer NOT NULL DEFAULT 8000;
