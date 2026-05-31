-- M07 · 技师排班三件套
--
-- 来源:packages/db/src/schema/schedule.ts + therapists.ts(slot_minutes/buffer_minutes 列)
-- 幂等:全 IF NOT EXISTS · 可重复执行
-- 应用:railway run --service loverush -- bun packages/db/scripts/apply.ts migrations/0019_m07_schedule.sql

BEGIN;

-- ── 1. 每周固定排班(7 行/技师)──
CREATE TABLE IF NOT EXISTS therapist_working_hours (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday              smallint NOT NULL, -- 0=周日 ... 6=周六
  start_time           time NOT NULL,
  end_time             time NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_weekday CHECK (weekday >= 0 AND weekday <= 6),
  CONSTRAINT chk_time_range CHECK (start_time < end_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_working_hours_therapist_weekday
  ON therapist_working_hours (therapist_user_id, weekday);

CREATE INDEX IF NOT EXISTS idx_working_hours_therapist
  ON therapist_working_hours (therapist_user_id);

-- ── 2. 临时挡时段(休假/请假)──
CREATE TABLE IF NOT EXISTS therapist_unavailable_period (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at             timestamptz NOT NULL,
  end_at               timestamptz NOT NULL,
  reason               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_unavail_range CHECK (start_at < end_at)
);

CREATE INDEX IF NOT EXISTS idx_unavail_therapist
  ON therapist_unavailable_period (therapist_user_id);

CREATE INDEX IF NOT EXISTS idx_unavail_range
  ON therapist_unavailable_period (therapist_user_id, start_at, end_at);

-- ── 3. therapists 表加 slot_minutes + buffer_minutes ──
ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS slot_minutes smallint NOT NULL DEFAULT 30;

ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS buffer_minutes smallint NOT NULL DEFAULT 15;

COMMIT;

-- 验证:
--   SELECT to_regclass('public.therapist_working_hours');
--   SELECT to_regclass('public.therapist_unavailable_period');
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='therapists' AND column_name IN ('slot_minutes','buffer_minutes');
