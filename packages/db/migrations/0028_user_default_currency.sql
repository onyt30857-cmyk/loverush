-- 0028 · 客户默认法币 · 0027 法币模型客户侧补完
--
-- 钱包余额 / 充值 / 偏好预算 等所有客户侧"钱"相关入口按此 currency 显示
-- 注册时根据 locale 默认:zh→USD · en→USD · th→THB · vi→USD · ms→MYR · id→IDR
-- 用户可在 /me 设置里改

ALTER TABLE users
  ADD COLUMN default_currency_code text;

COMMENT ON COLUMN users.default_currency_code IS '客户默认法币 · /me/balance / /me/recharge / /me/preferences 按此 currency 显';

-- 给现有用户按 locale 兜底
UPDATE users SET default_currency_code = CASE
  WHEN locale = 'th' THEN 'THB'
  WHEN locale = 'id' THEN 'IDR'
  WHEN locale = 'ms' THEN 'MYR'
  ELSE 'USD'
END
WHERE default_currency_code IS NULL;
