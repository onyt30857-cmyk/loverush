-- 0035 · 订单进入"待技师确认"的时刻 · 超时自动取消的计时基准
--
-- submitOrder 进 PENDING_CONFIRM 时 set;job 扫 COALESCE(pending_confirm_at, created_at) < now()-2h 自动取消。
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pending_confirm_at" timestamptz;
