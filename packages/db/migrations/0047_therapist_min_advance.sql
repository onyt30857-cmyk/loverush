-- 技师排班 · 最少提前预约期(分钟)· 默认 120(提前 2h)
-- 早于 now + min_advance_minutes 的 slot 不可约,防"还有几分钟就要约我"
ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS min_advance_minutes smallint NOT NULL DEFAULT 120;
