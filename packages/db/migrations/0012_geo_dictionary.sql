-- 0012 · M02 Phase 5 地理字典 · cities + areas + user_location_preference
--
-- 用途:全系统地理位置中枢 · 技师/客户/搜索/推荐/群发/admin 都依赖
-- 来源:packages/db/src/schema/geo.ts + therapists.ts add 2 columns
-- 幂等:CREATE TABLE/COLUMN IF NOT EXISTS · 可重复执行
-- 安全:仅 CREATE + ALTER ADD · 无 DROP · 旧 therapists.service_city text 保留
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0012_geo_dictionary.sql
--
-- 验证:
--   SELECT to_regclass('public.cities');
--   SELECT to_regclass('public.areas');
--   SELECT to_regclass('public.user_location_preference');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='therapists' AND column_name IN ('service_city_id','service_area_id');

BEGIN;

-- ─────────────────── 1. cities 字典 ───────────────────

CREATE TABLE IF NOT EXISTS cities (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text         NOT NULL,
  country_code    text         NOT NULL,
  translations    jsonb        NOT NULL DEFAULT '{}'::jsonb,
  lat_center      text,
  lng_center      text,
  sort_order      integer      NOT NULL DEFAULT 100,
  enabled         integer      NOT NULL DEFAULT 1,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_cities_code ON cities (code);
CREATE INDEX IF NOT EXISTS idx_cities_country_sort ON cities (country_code, sort_order);
CREATE INDEX IF NOT EXISTS idx_cities_enabled_sort ON cities (enabled, sort_order);

-- ─────────────────── 2. areas 字典 ───────────────────

CREATE TABLE IF NOT EXISTS areas (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid         NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  code            text         NOT NULL,
  translations    jsonb        NOT NULL DEFAULT '{}'::jsonb,
  lat_center      text,
  lng_center      text,
  sort_order      integer      NOT NULL DEFAULT 100,
  enabled         integer      NOT NULL DEFAULT 1,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_areas_city_code ON areas (city_id, code);
CREATE INDEX IF NOT EXISTS idx_areas_city_enabled_sort ON areas (city_id, enabled, sort_order);

-- ─────────────────── 3. 客户位置偏好 ───────────────────

CREATE TABLE IF NOT EXISTS user_location_preference (
  user_id         uuid         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city_id         uuid         REFERENCES cities(id) ON DELETE SET NULL,
  area_id         uuid         REFERENCES areas(id) ON DELETE SET NULL,
  source          text         NOT NULL DEFAULT 'manual',
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- ─────────────────── 4. therapists 加 service_city_id / service_area_id ───────────────────

ALTER TABLE therapists ADD COLUMN IF NOT EXISTS service_city_id uuid;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS service_area_id uuid;

-- 外键单独 ALTER(IF NOT EXISTS 模拟)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'therapists_service_city_id_fkey'
  ) THEN
    ALTER TABLE therapists
      ADD CONSTRAINT therapists_service_city_id_fkey
      FOREIGN KEY (service_city_id) REFERENCES cities(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'therapists_service_area_id_fkey'
  ) THEN
    ALTER TABLE therapists
      ADD CONSTRAINT therapists_service_area_id_fkey
      FOREIGN KEY (service_area_id) REFERENCES areas(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_therapists_service_city_id ON therapists (service_city_id);
CREATE INDEX IF NOT EXISTS idx_therapists_service_area_id ON therapists (service_area_id);

COMMIT;
