-- 0024 客户 GPS 实时坐标 · Phase 1 距离排序
-- 仅服务端用于 Haversine 距离计算 · 不暴露给技师 · 不返客户端原始坐标
-- last_gps_at 用于陈旧坐标过期(>24h 不算)

ALTER TABLE user_location_preference
  ADD COLUMN IF NOT EXISTS last_lat text,
  ADD COLUMN IF NOT EXISTS last_lng text,
  ADD COLUMN IF NOT EXISTS last_gps_at timestamptz;
