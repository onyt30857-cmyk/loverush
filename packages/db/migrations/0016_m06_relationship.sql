-- 0016 · M06 客户-技师关系画像 · relationship_tier enum + customer_relationship_profile
--
-- 用途:每对 (customer, therapist) 一行 · L0-L3 亲密度 + 跨次会话记忆
--       = AI 分身"被记得"的数据底座(技师给的昵称 / 来访次数 / 上次到访 / 私人备注 / 互动记忆)
-- 来源:packages/db/src/schema/relationship.ts + enums.ts(relationship_tier)
--       已 in code 提交但生产库缺表 → recommend / dashboard / ai_alter 读它即崩(同 0005/0015 教训)
-- 幂等:DO+EXCEPTION 建 enum · CREATE TABLE/INDEX IF NOT EXISTS · 可重复执行
-- 安全:仅 CREATE · 无 DROP · 无数据写入。失败自动 ROLLBACK(BEGIN/COMMIT 包裹)
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0016_m06_relationship.sql
--
-- 验证:
--   SELECT to_regclass('public.customer_relationship_profile');
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'relationship_tier';

BEGIN;

-- ─────────────────── enum ───────────────────

DO $$ BEGIN
  CREATE TYPE relationship_tier AS ENUM ('L0', 'L1', 'L2', 'L3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────── customer_relationship_profile ───────────────────

CREATE TABLE IF NOT EXISTS customer_relationship_profile (
  id                   uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          uuid               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id         uuid               NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,

  tier                 relationship_tier  NOT NULL DEFAULT 'L0',
  tier_score           integer            NOT NULL DEFAULT 0,
  last_tier_change_at  timestamptz,

  total_orders         integer            NOT NULL DEFAULT 0,
  total_spent_points   bigint             NOT NULL DEFAULT 0,
  total_tip_points     bigint             NOT NULL DEFAULT 0,

  first_order_at       timestamptz,
  last_order_at        timestamptz,
  last_interaction_at  timestamptz,

  avg_rating           integer            NOT NULL DEFAULT 0,
  rating_count         integer            NOT NULL DEFAULT 0,

  private_notes        text,
  customer_nickname    text,
  private_tags         text[],

  interaction_memory   jsonb              DEFAULT '{}'::jsonb,

  is_blocked           integer            NOT NULL DEFAULT 0,
  blocked_by           text,
  blocked_at           timestamptz,

  created_at           timestamptz        NOT NULL DEFAULT now(),
  updated_at           timestamptz        NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_relationship_pair       ON customer_relationship_profile (customer_id, therapist_id);
CREATE INDEX        IF NOT EXISTS idx_relationship_customer    ON customer_relationship_profile (customer_id, tier);
CREATE INDEX        IF NOT EXISTS idx_relationship_therapist   ON customer_relationship_profile (therapist_id, tier);
CREATE INDEX        IF NOT EXISTS idx_relationship_last_order  ON customer_relationship_profile (last_order_at);

COMMIT;
