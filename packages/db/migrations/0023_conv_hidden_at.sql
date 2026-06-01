-- M05 · per-user 会话软删字段 (参照微信)
-- 我删了对方不知道 · 对方再发消息自动 unhide (清回 NULL)
ALTER TABLE conversation_read_state ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_conv_read_user_hidden
  ON conversation_read_state (user_id, hidden_at);
