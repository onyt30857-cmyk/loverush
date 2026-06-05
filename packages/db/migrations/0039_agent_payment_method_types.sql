-- M16 P0-1 · 代理收款方式扩展:加 USDT-TRC20 / 泰国 PromptPay / 其它
--
-- 现有 agent_payment_method_type 只有 bank/alipay/wechat。纯分销下代理需要更多
-- 收款渠道(加密货币、本地即时转账等)。同 0038,ALTER TYPE ADD VALUE 不可在事务块内、
-- 新值同事务不可用,故逐条独立跑。幂等无害,无 down。
-- 字段模板(每种类型填哪些字段)由前端常量驱动:apps/web/lib/paymentMethods.ts。

ALTER TYPE agent_payment_method_type ADD VALUE IF NOT EXISTS 'usdt_trc20';
ALTER TYPE agent_payment_method_type ADD VALUE IF NOT EXISTS 'promptpay';
ALTER TYPE agent_payment_method_type ADD VALUE IF NOT EXISTS 'other';
