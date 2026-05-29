-- 0011 · M13 Phase 0 通知群发 · down
-- ⚠️ DROP CASCADE 会清除所有群发批次和投递记录 · 操作前备份

BEGIN;

DROP TABLE IF EXISTS notification_broadcast_deliveries CASCADE;
DROP TABLE IF EXISTS notification_broadcasts CASCADE;

COMMIT;
