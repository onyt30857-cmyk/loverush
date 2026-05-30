-- 0014 · M02 Phase 6 客户收藏技师
--
-- 联合主键 · 一行一关系
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0014_favorites.sql

BEGIN;

CREATE TABLE IF NOT EXISTS favorites (
  customer_id   uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  therapist_id  uuid         NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, therapist_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_customer ON favorites (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_favorites_therapist ON favorites (therapist_id);

COMMIT;
