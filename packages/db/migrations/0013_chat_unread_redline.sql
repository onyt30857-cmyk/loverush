-- 0013 · M05 Phase 1 私聊可用性修复 · per-user 已读 + 红线追踪
--
-- 用途:
--   1. conversation_read_state 表:per-user 已读位置(替代 messages.readAt 全表单字段)
--   2. messages 加 redline_action / redline_flags:追踪 sendMessage 的红线决策
--
-- 来源:packages/db/src/schema/conversation_read.ts + chat.ts ALTER
-- 幂等:CREATE TABLE/COLUMN IF NOT EXISTS · 可重复
-- 安全:仅 CREATE/ALTER · 无 DROP
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0013_chat_unread_redline.sql

BEGIN;

-- ─────────── 1. conversation_read_state ───────────

CREATE TABLE IF NOT EXISTS conversation_read_state (
  conversation_id        uuid         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id                uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id   uuid,
  last_read_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_read_user ON conversation_read_state (user_id, last_read_at);

-- ─────────── 2. messages 加红线字段 ───────────

ALTER TABLE messages ADD COLUMN IF NOT EXISTS redline_action text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS redline_flags  text[];

COMMIT;
