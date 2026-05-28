-- 0005 · M16 积分代理分销 · 创建 3 个 enum + 5 张表 + 索引
--
-- 来源:packages/db/src/schema/agents.ts + enums.ts(已 in code 提交但生产库缺表 → /point-purchases 全 500)
-- 幂等:DO + EXCEPTION + IF NOT EXISTS,可重复执行
-- 安全:仅 CREATE,无 DROP/ALTER/数据写入。失败自动 ROLLBACK(BEGIN/COMMIT 包裹)
--
-- 应用方式(任选其一):
--   A) Supabase 控制台 SQL Editor 粘贴本文件全文 → Run
--   B) psql "$DATABASE_URL" -f packages/db/migrations/0005_m16_agents.sql
--
-- 应用后验证:
--   SELECT to_regclass('public.agent_profiles');             -- 应非 null
--   SELECT to_regclass('public.point_purchase_orders');      -- 应非 null

BEGIN;

-- ──────── enums(3 个) ────────

DO $$ BEGIN
  CREATE TYPE agent_payment_method_type AS ENUM ('bank', 'alipay', 'wechat');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_wholesale_status AS ENUM ('pending', 'confirmed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE point_purchase_status AS ENUM (
    'created', 'customer_paid', 'agent_confirmed', 'points_sent',
    'disputed', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────── tables(5 张) ────────

-- 1) agent_profiles · 代理资料
CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id                 uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                  text        NOT NULL DEFAULT 'active',
  service_countries       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  service_cities          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total_wholesale_points  bigint      NOT NULL DEFAULT 0,
  total_sold_points       bigint      NOT NULL DEFAULT 0,
  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_status ON agent_profiles(status);

-- 2) agent_payment_methods · 代理收款方式
CREATE TABLE IF NOT EXISTS agent_payment_methods (
  id                    uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id         uuid                       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country               text                       NOT NULL,
  method_type           agent_payment_method_type  NOT NULL,
  fields                jsonb                      NOT NULL,
  min_purchase_points   bigint                     NOT NULL DEFAULT 0,
  is_active             boolean                    NOT NULL DEFAULT true,
  created_at            timestamptz                NOT NULL DEFAULT now(),
  updated_at            timestamptz                NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_pm_agent          ON agent_payment_methods(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_pm_agent_country  ON agent_payment_methods(agent_user_id, country);

-- 3) agent_customer_assignment · 客户↔代理绑定(1:1)
CREATE TABLE IF NOT EXISTS agent_customer_assignment (
  customer_user_id  uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  agent_user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  country           text,
  assigned_by       text        NOT NULL DEFAULT 'auto',
  assigned_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aca_agent ON agent_customer_assignment(agent_user_id);

-- 4) agent_wholesale_orders · 平台→代理 批发单
CREATE TABLE IF NOT EXISTS agent_wholesale_orders (
  id                  uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id       uuid                     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  points              bigint                   NOT NULL,
  usd_face_cents      bigint                   NOT NULL,
  usdt_amount_cents   bigint                   NOT NULL,
  usdt_txn_ref        text,
  status              agent_wholesale_status   NOT NULL DEFAULT 'pending',
  confirmed_by        uuid                     REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at        timestamptz,
  points_txn_id       uuid,
  created_at          timestamptz              NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_awo_agent  ON agent_wholesale_orders(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_awo_status ON agent_wholesale_orders(status);

-- 5) point_purchase_orders · 代理→客户 购买单
CREATE TABLE IF NOT EXISTS point_purchase_orders (
  id                         uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id           uuid                    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agent_user_id              uuid                    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  points                     bigint                  NOT NULL,
  local_amount               text,
  local_currency             text,
  payment_method_id          uuid                    REFERENCES agent_payment_methods(id) ON DELETE SET NULL,
  method_snapshot            jsonb,
  customer_paid_proof_url    text,
  status                     point_purchase_status   NOT NULL DEFAULT 'created',
  transfer_txn_id            uuid,
  dispute_status             text,
  customer_paid_at           timestamptz,
  agent_confirmed_at         timestamptz,
  points_sent_at             timestamptz,
  created_at                 timestamptz             NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ppo_customer      ON point_purchase_orders(customer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ppo_agent_status  ON point_purchase_orders(agent_user_id, status);

COMMIT;
