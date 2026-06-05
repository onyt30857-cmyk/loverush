-- M16 · 批发采购闭环
--
-- 1. 平台收款账户表:代理批发往哪转 USDT(后台配,代理可见)。
-- 2. 批发单补字段:代理转账凭证 agent_txn_ref + 标记时间 paid_marked_at + 驳回原因 reject_reason。
-- 全新建 + 加列,不碰现有数据,可在事务内执行。

CREATE TABLE platform_receiving_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method_type text NOT NULL,
  label text NOT NULL,
  fields jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pra_active ON platform_receiving_accounts (is_active, display_order);

ALTER TABLE agent_wholesale_orders ADD COLUMN IF NOT EXISTS agent_txn_ref text;
ALTER TABLE agent_wholesale_orders ADD COLUMN IF NOT EXISTS paid_marked_at timestamptz;
ALTER TABLE agent_wholesale_orders ADD COLUMN IF NOT EXISTS reject_reason text;
