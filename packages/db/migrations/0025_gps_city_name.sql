-- 0025 · GPS 反查的城市名(即使不在字典也存)
-- 用户体验:在 LoveRush 字典外的城市也能看到 chip 显示真实位置

ALTER TABLE user_location_preference
  ADD COLUMN IF NOT EXISTS last_city_name text,
  ADD COLUMN IF NOT EXISTS last_area_name text;
