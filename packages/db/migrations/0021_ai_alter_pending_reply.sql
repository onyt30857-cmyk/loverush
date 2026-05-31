-- M06b 模块② 配套 · 拟人回复时机：待回复调度表
-- 客户发消息不立即生成回复，登记"计划在 scheduled_at 回"；连发→同行 scheduled_at 后推=debounce。
-- 高频 tick 扫 scheduled_at <= now 的行触发回复后删行。一会话一行(唯一索引)。

BEGIN;

CREATE TABLE IF NOT EXISTS ai_alter_pending_reply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_locale text,
  last_customer_msg_at timestamptz NOT NULL,
  scheduled_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- 一会话一行 → ON CONFLICT(conversation_id) 做 upsert 实现 debounce
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_reply_conversation
  ON ai_alter_pending_reply (conversation_id);

-- tick 按到点扫
CREATE INDEX IF NOT EXISTS idx_pending_reply_scheduled
  ON ai_alter_pending_reply (scheduled_at);

COMMIT;
