-- 0010 · M02 Phase 4 搜索后台 · 日志 + 热门词 + 类目
--
-- 用途:三张表为搜索后台提供数据底座
--   1. search_query_logs    每次搜索 + 点击的明细日志(BI 看板源)
--   2. search_hot_keywords  运营可配的热门词 chips
--   3. search_categories    运营可配的类目网格
--
-- 来源:packages/db/src/schema/search.ts
-- 幂等:CREATE TABLE IF NOT EXISTS · 可重复执行
-- 安全:仅 CREATE · 无 DROP/ALTER/数据写入
--
-- 应用:
--   psql "$DATABASE_URL" -f packages/db/migrations/0010_search_admin.sql
--
-- 验证:
--   SELECT to_regclass('public.search_query_logs');
--   SELECT to_regclass('public.search_hot_keywords');
--   SELECT to_regclass('public.search_categories');

BEGIN;

-- ─────────────────────── 1. 搜索日志 ───────────────────────

CREATE TABLE IF NOT EXISTS search_query_logs (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id                uuid         REFERENCES users(id) ON DELETE SET NULL,

  raw_query              text         NOT NULL,
  parsed_query           jsonb,

  result_count           integer      NOT NULL DEFAULT 0,
  personalized           integer      NOT NULL DEFAULT 0,

  clicked_therapist_id   uuid,
  clicked_at             timestamptz,

  locale                 text,
  ip_hash                text,

  occurred_at            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_log_user_occurred ON search_query_logs (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_search_log_occurred ON search_query_logs (occurred_at);
CREATE INDEX IF NOT EXISTS idx_search_log_raw_query ON search_query_logs (raw_query);
CREATE INDEX IF NOT EXISTS idx_search_log_clicked ON search_query_logs (clicked_therapist_id);

-- ─────────────────────── 2. 热门词运营物料 ───────────────────────

CREATE TABLE IF NOT EXISTS search_hot_keywords (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  keyword                text         NOT NULL,
  display_label          text         NOT NULL,

  sort_order             integer      NOT NULL DEFAULT 100,
  enabled                integer      NOT NULL DEFAULT 1,

  target_locales         text[],
  target_cities          text[],

  starts_at              timestamptz,
  ends_at                timestamptz,

  created_by             uuid,
  updated_by             uuid,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_hot_keyword ON search_hot_keywords (keyword);
CREATE INDEX IF NOT EXISTS idx_hot_enabled_sort ON search_hot_keywords (enabled, sort_order);

-- ─────────────────────── 3. 类目网格运营物料 ───────────────────────

CREATE TABLE IF NOT EXISTS search_categories (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  code                   text         NOT NULL,
  emoji                  text,
  label                  text         NOT NULL,

  sort_order             integer      NOT NULL DEFAULT 100,
  enabled                integer      NOT NULL DEFAULT 1,

  filter_condition       jsonb,

  target_locales         text[],
  target_cities          text[],

  created_by             uuid,
  updated_by             uuid,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_search_category_code ON search_categories (code);
CREATE INDEX IF NOT EXISTS idx_search_category_enabled_sort ON search_categories (enabled, sort_order);

-- ─────────────────────── 初始数据(可选 · 留 admin 后台改) ───────────────────────
-- 不在 migration 里插数据 · 由 admin 后台手动添加 · 或单独的 seed 脚本灌入
-- 这样运营改了之后重跑 migration 不会被覆盖

COMMIT;
