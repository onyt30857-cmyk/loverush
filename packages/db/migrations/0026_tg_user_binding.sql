-- M17 · Telegram 渠道 · TG 用户 ↔ loverush 账号绑定
-- inline 浏览匿名；Mini App 下单/聊天时用 initData 识别 TG 用户，查此表绑定/建号。

BEGIN;

CREATE TABLE IF NOT EXISTS tg_user_binding (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id     bigint NOT NULL,
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
  tg_username    text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  bound_at       timestamptz,
  last_active_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tg_user_binding_tg_user
  ON tg_user_binding (tg_user_id);

COMMIT;
