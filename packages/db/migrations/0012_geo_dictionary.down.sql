-- 0012 · M02 Phase 5 地理字典 · down
-- ⚠️ DROP CASCADE 清除所有城市/区域/用户位置偏好数据 · 操作前备份
-- ⚠️ therapists.service_city_id / service_area_id 也会一并 SET NULL

BEGIN;

ALTER TABLE therapists DROP CONSTRAINT IF EXISTS therapists_service_city_id_fkey;
ALTER TABLE therapists DROP CONSTRAINT IF EXISTS therapists_service_area_id_fkey;
ALTER TABLE therapists DROP COLUMN IF EXISTS service_city_id;
ALTER TABLE therapists DROP COLUMN IF EXISTS service_area_id;

DROP TABLE IF EXISTS user_location_preference CASCADE;
DROP TABLE IF EXISTS areas CASCADE;
DROP TABLE IF EXISTS cities CASCADE;

COMMIT;
