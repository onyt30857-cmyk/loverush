-- M02b/M04 Phase 1 · 技师发布服务系统
-- 1) service_categories 字典(平台预设服务类型 · admin 可改)
-- 2) shows 表(技师挂的节目 · 客户抢拍)
-- 3) orders 加 source_show_id 字段(节目订单关联)

BEGIN;

-- ────────────────── service_categories ──────────────────
CREATE TABLE IF NOT EXISTS service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_zh text NOT NULL,
  name_en text NOT NULL,
  description text,
  icon_emoji text,
  display_order integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_categories_active
  ON service_categories (is_active, display_order);

-- Seed 6 默认服务类型(对齐前端硬编码 + M03/M04 文档 enum)
INSERT INTO service_categories (code, name_zh, name_en, description, icon_emoji, display_order)
VALUES
  ('thai',           '泰式按摩',   'Thai Massage',        '传统泰式拉伸 + 指压', '🌿', 10),
  ('oil',            '精油按摩',   'Oil Massage',         '香薰精油全身放松',    '🌸', 20),
  ('chinese_tuina',  '中医推拿',   'Chinese Tui-Na',      '经络疏通 + 拔罐刮痧', '🍃', 30),
  ('spa',            'SPA',        'SPA',                 '全套水疗 + 护理',     '💆', 40),
  ('foot',           '足疗',       'Foot Reflexology',    '足底反射区按摩',      '🦶', 50),
  ('shiatsu',        '日式指压',   'Shiatsu',             '日式深层指压',        '🇯🇵', 60)
ON CONFLICT (code) DO NOTHING;

-- ────────────────── shows ──────────────────
CREATE TABLE IF NOT EXISTS shows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  category_code text NOT NULL,

  start_time timestamptz NOT NULL,
  duration_min integer NOT NULL,

  price_points integer NOT NULL,

  add_ons jsonb NOT NULL DEFAULT '[]'::jsonb,

  includes_note text,
  excludes_note text,

  slots_total integer NOT NULL DEFAULT 1,
  slots_remaining integer NOT NULL DEFAULT 1,

  service_city text,
  service_area text,

  status text NOT NULL DEFAULT 'draft',

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT shows_slots_check CHECK (slots_remaining >= 0 AND slots_remaining <= slots_total),
  CONSTRAINT shows_status_check CHECK (status IN ('draft', 'open', 'closed', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_shows_therapist_status ON shows (therapist_user_id, status);
CREATE INDEX IF NOT EXISTS idx_shows_open_start ON shows (start_time, status);
CREATE INDEX IF NOT EXISTS idx_shows_category_start ON shows (category_code, start_time);

-- ────────────────── orders 加 source_show_id ──────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS source_show_id uuid REFERENCES shows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_show
  ON orders (source_show_id)
  WHERE source_show_id IS NOT NULL;

COMMIT;
