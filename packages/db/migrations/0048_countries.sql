-- 国家字典单一事实源 · 把散落的时区/默认法币/国旗收成一张表
-- 加一个国家 = 后台插一行 → resolveTz / 法币立即生效(硬编码降兜底)
-- cities.timezone 城市级覆盖(印尼这类跨时区国家用)

-- ── 1. countries 字典表 ──
CREATE TABLE IF NOT EXISTS countries (
  code             text PRIMARY KEY,            -- ISO alpha-2 大写
  name_zh          text NOT NULL,
  name_en          text NOT NULL,
  flag_emoji       text,
  timezone         text NOT NULL,               -- IANA · 国家级默认
  default_currency text NOT NULL,               -- → currencies.code
  dial_code        text,
  enabled          integer NOT NULL DEFAULT 1,
  sort_order       integer NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_countries_enabled_sort ON countries (enabled, sort_order);

-- ── 2. cities 城市级时区覆盖列 ──
ALTER TABLE cities ADD COLUMN IF NOT EXISTS timezone text;

-- ── 3. 补齐法币元数据(无汇率 · 上线前由后台加 exchange_rate;已存在的 THB/SGD/MYR/IDR/USD 跳过)──
INSERT INTO currencies (code, symbol, name_zh, name_en, decimals, display_order, is_active) VALUES
  ('VND', '₫',   '越南盾',     'Vietnamese Dong',   0, 50,  1),
  ('PHP', '₱',   '菲律宾比索', 'Philippine Peso',   2, 60,  1),
  ('CNY', '¥',   '人民币',     'Chinese Yuan',      2, 70,  1),
  ('HKD', 'HK$', '港币',       'Hong Kong Dollar',  2, 80,  1),
  ('TWD', 'NT$', '新台币',     'Taiwan Dollar',     2, 90,  1),
  ('JPY', '¥',   '日元',       'Japanese Yen',      0, 110, 1),
  ('KRW', '₩',   '韩元',       'Korean Won',        0, 120, 1)
ON CONFLICT (code) DO NOTHING;

-- ── 4. seed 国家(合并原 COUNTRY_TZ + COUNTRY_TO_CURRENCY + 国旗)──
INSERT INTO countries (code, name_zh, name_en, flag_emoji, timezone, default_currency, dial_code, sort_order) VALUES
  ('TH', '泰国',     'Thailand',      '🇹🇭', 'Asia/Bangkok',      'THB', '+66',  10),
  ('VN', '越南',     'Vietnam',       '🇻🇳', 'Asia/Ho_Chi_Minh',  'VND', '+84',  20),
  ('SG', '新加坡',   'Singapore',     '🇸🇬', 'Asia/Singapore',    'SGD', '+65',  30),
  ('MY', '马来西亚', 'Malaysia',      '🇲🇾', 'Asia/Kuala_Lumpur', 'MYR', '+60',  40),
  ('ID', '印度尼西亚','Indonesia',    '🇮🇩', 'Asia/Jakarta',      'IDR', '+62',  50),
  ('PH', '菲律宾',   'Philippines',   '🇵🇭', 'Asia/Manila',       'PHP', '+63',  60),
  ('KH', '柬埔寨',   'Cambodia',      '🇰🇭', 'Asia/Phnom_Penh',   'USD', '+855', 70),
  ('CN', '中国',     'China',         '🇨🇳', 'Asia/Shanghai',     'CNY', '+86',  100),
  ('HK', '中国香港', 'Hong Kong',     '🇭🇰', 'Asia/Hong_Kong',    'HKD', '+852', 110),
  ('TW', '中国台湾', 'Taiwan',        '🇹🇼', 'Asia/Taipei',       'TWD', '+886', 120),
  ('JP', '日本',     'Japan',         '🇯🇵', 'Asia/Tokyo',        'JPY', '+81',  130),
  ('KR', '韩国',     'South Korea',   '🇰🇷', 'Asia/Seoul',        'KRW', '+82',  140),
  ('US', '美国',     'United States', '🇺🇸', 'America/New_York',  'USD', '+1',   200)
ON CONFLICT (code) DO NOTHING;
