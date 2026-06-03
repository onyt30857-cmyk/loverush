-- M18 心动陪伴
CREATE TABLE IF NOT EXISTS "companion_actions" (
  "code" text PRIMARY KEY,
  "action_type" text NOT NULL,
  "price_points" integer NOT NULL,
  "revenue_share_bps" integer NOT NULL DEFAULT 7000,
  "exp_reward" integer NOT NULL DEFAULT 10,
  "is_active" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "intimacy" (
  "customer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "therapist_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exp" integer NOT NULL DEFAULT 0,
  "level" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("customer_id", "therapist_user_id")
);
CREATE INDEX IF NOT EXISTS "idx_intimacy_therapist" ON "intimacy" ("therapist_user_id");
