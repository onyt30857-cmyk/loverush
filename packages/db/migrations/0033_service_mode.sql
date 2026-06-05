-- 0033 服务模式 · 技师标明到店/上门/两者
-- 非破坏·可空加列(NOT NULL + DEFAULT 'outcall')· 默认上门=保持历史假设全上门
-- 幂等: ADD COLUMN IF NOT EXISTS
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'outcall';
