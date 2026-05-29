-- 0009 · 无效账户治理 · users.activated_at
--
-- 背景:register 立刻写 users 行,用户中途退出留下"半成品"账户。
-- 治理:加 activated_at 字段,只有用户产生真实业务活动时才 set。
--       NULL = 未激活(候选清理);NOT NULL = 真实用户。
--
-- 应用方式:
--   psql "$DATABASE_URL" -f packages/db/migrations/0009_users_activated_at.sql
--
-- 应用后验证:
--   SELECT count(*) AS total, count(activated_at) AS activated,
--          count(*) - count(activated_at) AS pending_cleanup
--   FROM users;

BEGIN;

-- 1. 加列
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_activated_at ON users (activated_at);

-- 2. Backfill · 用已有业务活动的最早时间作为 activated_at
--    (有 customer_assistant_sessions / orders / conversations 的视为真实用户)
UPDATE users u
SET activated_at = sub.first_activity
FROM (
  SELECT
    user_id,
    MIN(activity_at) AS first_activity
  FROM (
    -- AI 助理会话(M03 v2 home 仪表盘)
    SELECT user_id, created_at AS activity_at FROM customer_assistant_sessions

    UNION ALL

    -- 订单(客户侧)
    SELECT customer_id AS user_id, created_at AS activity_at FROM orders WHERE customer_id IS NOT NULL

    UNION ALL

    -- 订单(技师侧)
    SELECT therapist_user_id AS user_id, created_at AS activity_at FROM orders WHERE therapist_user_id IS NOT NULL

    UNION ALL

    -- 私聊会话
    SELECT customer_id AS user_id, created_at AS activity_at FROM conversations WHERE customer_id IS NOT NULL

    UNION ALL

    SELECT therapist_user_id AS user_id, created_at AS activity_at FROM conversations WHERE therapist_user_id IS NOT NULL
  ) all_activity
  GROUP BY user_id
) sub
WHERE u.id = sub.user_id
  AND u.activated_at IS NULL;

-- 3. 注释
COMMENT ON COLUMN users.activated_at IS
  '账户首次产生真实业务活动的时间。NULL = 未激活(可清理)。set 时机:首次 chat / 首次 conversation / 首次 order。';

COMMIT;

-- 应用后查询语句(可手动跑):
--   SELECT count(*) FILTER (WHERE activated_at IS NULL AND created_at < NOW() - INTERVAL '24 hours') AS to_cleanup,
--          count(*) FILTER (WHERE activated_at IS NULL) AS all_inactive,
--          count(*) FILTER (WHERE activated_at IS NOT NULL) AS activated
--   FROM users;
