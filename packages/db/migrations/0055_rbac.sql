-- 迁移 0055 · RBAC 角色目录 + 角色权限映射表
-- 幂等：CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING

-- ─── 角色目录表 ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "roles" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"         text NOT NULL,
  "name_zh"     text NOT NULL,
  "description" text,
  "is_system"   boolean NOT NULL DEFAULT false,
  "created_by"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_roles_key" ON "roles"("key");

-- ─── 角色权限映射表 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_key"       text NOT NULL,
  "permission_key" text NOT NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_role_permissions_rk_pk"
  ON "role_permissions"("role_key", "permission_key");

CREATE INDEX IF NOT EXISTS "idx_role_permissions_role_key"
  ON "role_permissions"("role_key");
