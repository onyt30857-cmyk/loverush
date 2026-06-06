-- 0043 · 预约前两档提醒 · 去重标记列
-- 来源:packages/db/src/schema/orders.ts(reminder1hSentAt / reminder10mSentAt)
-- 非破坏 · 可空加列 · 幂等 ADD COLUMN IF NOT EXISTS
-- 上线顺序:先在生产跑本迁移,再 push 代码(防部署窗口报列不存在)。
-- 用途:appointment-reminder cron 防同一订单同一档位重复推送。

ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_1h_sent_at timestamp with time zone;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder_10m_sent_at timestamp with time zone;
