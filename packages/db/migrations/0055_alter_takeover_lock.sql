-- 0055 · 技师手动锁定接管(我来接管 / 交还分身)
-- conversations.alter_locked_at:非 null = 技师在亲自聊、分身完全让位(不自动过期,直到技师点"交还分身")
-- 配合 ai_alter.shouldFireAiAlter 的锁定门控 + takeoverWindowMin(3min)自动接管窗口
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS alter_locked_at timestamptz;
