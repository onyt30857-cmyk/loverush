CREATE TABLE IF NOT EXISTS "chat_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "therapist_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "url" text NOT NULL, "thumbnail_url" text,
  "tier" text NOT NULL DEFAULT 'free', "price_points" integer NOT NULL DEFAULT 0,
  "intimacy_min" integer NOT NULL DEFAULT 0, "weight" integer NOT NULL DEFAULT 1,
  "is_active" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_chat_media_therapist" ON "chat_media" ("therapist_user_id","is_active");
CREATE TABLE IF NOT EXISTS "chat_media_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "therapist_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "media_id" uuid NOT NULL REFERENCES "chat_media"("id") ON DELETE CASCADE,
  "conversation_id" uuid, "sent_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_chat_media_send" ON "chat_media_sends" ("therapist_user_id","customer_id","media_id");
CREATE INDEX IF NOT EXISTS "idx_chat_media_send_pair" ON "chat_media_sends" ("therapist_user_id","customer_id","sent_at");
