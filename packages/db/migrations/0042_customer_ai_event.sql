-- 0042 跨 AI 统一事件流 customer_ai_event(append-only 单一事实源)
-- 画像分治 + 事件统一:支撑跨 AI 风控聚合 / 合规一键删除 / 跨 AI 上下文
CREATE TABLE IF NOT EXISTS customer_ai_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL,
  kind text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  ref_therapist_id uuid,
  conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_ai_event_user_created ON customer_ai_event (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_ai_event_user_kind ON customer_ai_event (user_id, kind);
CREATE INDEX IF NOT EXISTS idx_customer_ai_event_source_kind ON customer_ai_event (source, kind);
