-- 0006 · M03 客户 AI 助理 · 长期记忆 4 张表 + RLS
--
-- 来源:packages/db/src/schema/assistant_memory.ts
-- 幂等:DO + EXCEPTION + IF NOT EXISTS,可重复执行
-- 安全:仅 CREATE,无 DROP/ALTER/数据写入
--
-- 应用方式:
--   psql "$DATABASE_URL" -f packages/db/migrations/0006_m03_assistant_memory.sql
--
-- 应用后验证:
--   SELECT to_regclass('public.customer_saved_memory');
--   SELECT to_regclass('public.customer_reference_memory');
--   SELECT to_regclass('public.customer_interest_clusters');
--   SELECT to_regclass('public.customer_outreach_state');
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_saved_memory';
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_reference_memory';

BEGIN;

-- ──────── 1) customer_saved_memory (L1 facts + L2 stable_prefs) ────────

CREATE TABLE IF NOT EXISTS customer_saved_memory (
  user_id                   uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  facts                     jsonb       DEFAULT '{}'::jsonb,
  stable_prefs              jsonb       DEFAULT '{}'::jsonb,
  shame_safe_prefs          jsonb       DEFAULT '{}'::jsonb,
  taboo_zones               text[]      DEFAULT '{}',
  exported_at               timestamptz,
  deletion_scheduled_at     timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csmem_deletion
  ON customer_saved_memory (deletion_scheduled_at);

-- ──────── 2) customer_reference_memory (L3 + L4 + L5) ────────

CREATE TABLE IF NOT EXISTS customer_reference_memory (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type         text        NOT NULL CHECK (memory_type IN ('rotating','relation','diff')),
  content             text        NOT NULL,
  embedding           jsonb,                                 -- 暂存,pgvector 启用时改 vector(1536)
  entities            text[]      DEFAULT '{}',
  importance          integer     NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  cluster_id          integer     CHECK (cluster_id IS NULL OR cluster_id BETWEEN 1 AND 5),
  endpoint            text        NOT NULL DEFAULT 'cloud' CHECK (endpoint IN ('cloud','edge')),
  ref_therapist_id    uuid,
  ref_order_id        uuid,
  archived_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crmem_user_type
  ON customer_reference_memory (user_id, memory_type, valid_to);
CREATE INDEX IF NOT EXISTS idx_crmem_user_cluster
  ON customer_reference_memory (user_id, cluster_id);
CREATE INDEX IF NOT EXISTS idx_crmem_ref_therapist
  ON customer_reference_memory (user_id, ref_therapist_id);
CREATE INDEX IF NOT EXISTS idx_crmem_recorded_at
  ON customer_reference_memory (recorded_at);

-- ──────── 3) customer_interest_clusters (3-5 簇质心) ────────

CREATE TABLE IF NOT EXISTS customer_interest_clusters (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cluster_idx   integer     NOT NULL CHECK (cluster_idx BETWEEN 1 AND 5),
  label         text,
  centroid      jsonb,
  sample_size   integer     NOT NULL DEFAULT 0,
  top_entities  text[]      DEFAULT '{}',
  weight        integer     NOT NULL DEFAULT 100,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_user_idx
  ON customer_interest_clusters (user_id, cluster_idx);

-- ──────── 4) customer_outreach_state (push/召回频控 + 主权开关) ────────

CREATE TABLE IF NOT EXISTS customer_outreach_state (
  user_id                  uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  proactive_enabled        boolean     NOT NULL DEFAULT true,
  silent_recall_enabled    boolean     NOT NULL DEFAULT true,
  weekly_push_count        integer     NOT NULL DEFAULT 0,
  weekly_push_reset_at     timestamptz,
  monthly_recall_count     integer     NOT NULL DEFAULT 0,
  monthly_recall_reset_at  timestamptz,
  last_push_at             timestamptz,
  last_recall_at           timestamptz,
  regular_time_slot        jsonb,
  last_order_at            timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_last_order
  ON customer_outreach_state (last_order_at);
CREATE INDEX IF NOT EXISTS idx_outreach_proactive
  ON customer_outreach_state (proactive_enabled);

-- ──────── 5) Row Level Security ────────

ALTER TABLE customer_saved_memory     ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_reference_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interest_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_outreach_state   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY csmem_isolation ON customer_saved_memory
    USING (user_id = current_setting('app.user_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY crmem_isolation ON customer_reference_memory
    USING (user_id = current_setting('app.user_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY cic_isolation ON customer_interest_clusters
    USING (user_id = current_setting('app.user_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY cos_isolation ON customer_outreach_state
    USING (user_id = current_setting('app.user_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 说明:RLS 默认对 superuser/owner 不生效,服务端用专用 role 连接并
-- SET LOCAL app.user_id = '<uuid>' 注入 user_id;后端代码用 BYPASS 路径
-- 走 admin role 完成跨用户 job(归档/聚类/push 扫描)

COMMIT;
