-- 0034 · 陪聊付费服务 · 每日免费额度 + 陪聊时段(倒计时)
--
-- chat_quota_usage: (客户×技师×日期) 每日免费分身回复计数,用完→软墙
-- chat_session: 陪聊时段,买了即激活 start_at=now、expire_at=now+时长,期间不限条畅聊

CREATE TABLE IF NOT EXISTS "chat_quota_usage" (
  "customer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "therapist_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "usage_date" text NOT NULL,
  "used_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("customer_id", "therapist_user_id", "usage_date")
);

CREATE TABLE IF NOT EXISTS "chat_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "therapist_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "duration_minutes" integer NOT NULL,
  "start_at" timestamptz NOT NULL,
  "expire_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_chat_session_active" ON "chat_session" ("customer_id", "therapist_user_id", "expire_at");
