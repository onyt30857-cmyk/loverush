-- 0011 · M13 Phase 0 通知群发 · 批次 + 投递明细
--
-- 用途:让 admin 端能创建 + 立即发送一条群发推送到选定受众
--
-- 来源:packages/db/src/schema/broadcasts.ts
-- 幂等:CREATE TABLE IF NOT EXISTS · 可重复执行
-- 安全:仅 CREATE · 无 DROP/ALTER/数据写入
--
-- 应用:
--   psql "$DATABASE_URL" -f packages/db/migrations/0011_notification_broadcasts.sql
--
-- 验证:
--   SELECT to_regclass('public.notification_broadcasts');
--   SELECT to_regclass('public.notification_broadcast_deliveries');

BEGIN;

-- ─────────────── 1. 群发批次主表 ───────────────

CREATE TABLE IF NOT EXISTS notification_broadcasts (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),

  created_by_admin_id     uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name                    text         NOT NULL,

  -- 内容
  title                   text         NOT NULL,
  body                    text,
  body_translations       jsonb,
  level                   text         NOT NULL DEFAULT 'info',
  category                text         NOT NULL DEFAULT 'promo',
  deep_link               text,

  -- 受众
  audience_rule           jsonb        NOT NULL,
  audience_count          integer      NOT NULL DEFAULT 0,

  -- 投递配置
  channels                text[]       NOT NULL DEFAULT ARRAY[]::text[],
  bypass_user_prefs       integer      NOT NULL DEFAULT 0,

  -- 状态机
  status                  text         NOT NULL DEFAULT 'draft',
  scheduled_at            timestamptz,
  started_at              timestamptz,
  completed_at            timestamptz,

  -- 统计
  sent_count              integer      NOT NULL DEFAULT 0,
  failed_count            integer      NOT NULL DEFAULT 0,
  skipped_count           integer      NOT NULL DEFAULT 0,

  error_message           text,

  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_status_created ON notification_broadcasts (status, created_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_creator ON notification_broadcasts (created_by_admin_id);

-- ─────────────── 2. 投递明细 ───────────────

CREATE TABLE IF NOT EXISTS notification_broadcast_deliveries (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id            uuid         NOT NULL REFERENCES notification_broadcasts(id) ON DELETE CASCADE,
  recipient_user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id         uuid         REFERENCES notifications(id) ON DELETE SET NULL,
  status                  text         NOT NULL,    -- sent | skipped | failed
  skip_reason             text,                     -- 'pref_off' | 'banned' | 'no_user' | error msg
  created_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_broadcast_delivery_pair
  ON notification_broadcast_deliveries (broadcast_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_delivery_status
  ON notification_broadcast_deliveries (broadcast_id, status);

COMMIT;
