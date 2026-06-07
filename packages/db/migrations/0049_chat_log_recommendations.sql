-- 0049 · 助理对话留存推荐技师快照 · assistant_chat_log 加 recommendations
-- 来源:packages/db/src/schema/assistant_chat_log.ts(recommendations)
-- 非破坏 · 可空加列 · 幂等
-- 用途:AI 助理推荐的技师卡片重开浏览器后不见 → 把当轮推荐快照(id/名/头像/城/在线/理由)
--       存进对话日志,/assistant/chat/history 返回,前端还原成卡片。先生产跑再 push。

ALTER TABLE assistant_chat_log ADD COLUMN IF NOT EXISTS recommendations jsonb;
