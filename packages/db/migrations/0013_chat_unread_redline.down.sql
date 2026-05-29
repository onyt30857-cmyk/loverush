-- 0013 down · 清除已读状态 + 红线追踪
-- ⚠️ DROP CASCADE 会清空所有 per-user 已读位置 · 操作前备份

BEGIN;

ALTER TABLE messages DROP COLUMN IF EXISTS redline_action;
ALTER TABLE messages DROP COLUMN IF EXISTS redline_flags;

DROP TABLE IF EXISTS conversation_read_state CASCADE;

COMMIT;
