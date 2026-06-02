-- 0026 · GPS 反查的国家 ISO alpha-2 码(用于 hero 卡显示国旗/国家)

ALTER TABLE user_location_preference
  ADD COLUMN IF NOT EXISTS last_country_code text;
