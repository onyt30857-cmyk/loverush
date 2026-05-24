-- Migration · Phase 24 · admin 操作审计表
-- 对应 packages/db/src/schema/audit.ts
-- 应用：psql $DATABASE_URL -f migrations/0002_admin_audit_log.sql

BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role    text NOT NULL,           -- admin / finance / cs / auditor / ops / system

  action        text NOT NULL,           -- user.suspend / withdraw.approve / role.grant ...
  target_type   text NOT NULL,           -- user / order / withdrawal / role / flag / ticket
  target_id     text,

  before        jsonb,
  after         jsonb,

  reason        text,
  request_id    text,
  ip            inet,
  user_agent    text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_created  ON admin_audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target         ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON admin_audit_log (action, created_at DESC);

-- append-only 软约束（DBA 可换成更严格的触发器）
COMMENT ON TABLE admin_audit_log IS
  'Append-only. UPDATE / DELETE should be blocked at the role level; do not grant write privileges other than INSERT to the application role.';

COMMIT;
