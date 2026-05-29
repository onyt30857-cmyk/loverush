-- ═══════════════════════════════════════════════
-- LoveRush · 地理字典种子(M02 Phase 5)
-- 执行:psql $DATABASE_URL -f packages/db/src/seed/0003_cities_areas_seed.sql
--
-- 内容:
--   - 泰国 5 城市(曼谷/清迈/普吉/帕岸/苏梅)
--   - 曼谷 8 核心区域(素坤逸/Asok/Thonglor/Phrom Phong/Silom/Sathorn/暹罗/唐人街)
--   - 马来 3 城市 · 越南 3 · 印尼 2
-- 幂等:ON CONFLICT(code) DO NOTHING · 可重复执行
-- ═══════════════════════════════════════════════

-- ─────────── 泰国 ───────────

INSERT INTO cities (code, country_code, translations, lat_center, lng_center, sort_order) VALUES
  ('bangkok',     'TH', '{"zh":"曼谷","en":"Bangkok","th":"กรุงเทพ"}',     '13.7563', '100.5018',  10),
  ('chiang-mai',  'TH', '{"zh":"清迈","en":"Chiang Mai","th":"เชียงใหม่"}','18.7883',  '98.9853',  20),
  ('phuket',      'TH', '{"zh":"普吉","en":"Phuket","th":"ภูเก็ต"}',         '7.8804',  '98.3923',  30),
  ('koh-phangan', 'TH', '{"zh":"帕岸岛","en":"Koh Phangan","th":"เกาะพะงัน"}', '9.7340', '100.0290',  40),
  ('koh-samui',   'TH', '{"zh":"苏梅","en":"Koh Samui","th":"เกาะสมุย"}',  '9.5018', '100.0143',  50)
ON CONFLICT (code) DO NOTHING;

-- ─────────── 马来西亚 ───────────

INSERT INTO cities (code, country_code, translations, lat_center, lng_center, sort_order) VALUES
  ('kuala-lumpur','MY', '{"zh":"吉隆坡","en":"Kuala Lumpur","ms":"Kuala Lumpur"}', '3.1390', '101.6869', 100),
  ('penang',      'MY', '{"zh":"槟城","en":"Penang","ms":"Pulau Pinang"}',          '5.4164', '100.3327', 110),
  ('langkawi',    'MY', '{"zh":"兰卡威","en":"Langkawi","ms":"Langkawi"}',          '6.3500', '99.8000',  120)
ON CONFLICT (code) DO NOTHING;

-- ─────────── 越南 ───────────

INSERT INTO cities (code, country_code, translations, lat_center, lng_center, sort_order) VALUES
  ('ho-chi-minh', 'VN', '{"zh":"胡志明","en":"Ho Chi Minh","vi":"Thành phố Hồ Chí Minh"}', '10.8231', '106.6297', 200),
  ('hanoi',       'VN', '{"zh":"河内","en":"Hanoi","vi":"Hà Nội"}',                       '21.0285', '105.8542', 210),
  ('da-nang',     'VN', '{"zh":"岘港","en":"Da Nang","vi":"Đà Nẵng"}',                    '16.0544', '108.2022', 220)
ON CONFLICT (code) DO NOTHING;

-- ─────────── 印尼 ───────────

INSERT INTO cities (code, country_code, translations, lat_center, lng_center, sort_order) VALUES
  ('jakarta',     'ID', '{"zh":"雅加达","en":"Jakarta","id":"Jakarta"}',                 '-6.2088', '106.8456', 300),
  ('bali',        'ID', '{"zh":"巴厘岛","en":"Bali","id":"Bali"}',                       '-8.3405', '115.0920', 310)
ON CONFLICT (code) DO NOTHING;

-- ─────────── 曼谷 8 核心区域 ───────────

INSERT INTO areas (city_id, code, translations, lat_center, lng_center, sort_order)
SELECT id, x.code, x.tr::jsonb, x.lat, x.lng, x.so
FROM cities, (VALUES
  ('asok',        '{"zh":"Asok","en":"Asok","th":"อโศก"}',                 '13.7375', '100.5605',  10),
  ('thonglor',    '{"zh":"Thonglor","en":"Thonglor","th":"ทองหล่อ"}',     '13.7395', '100.5816',  20),
  ('phrom-phong', '{"zh":"Phrom Phong","en":"Phrom Phong","th":"พร้อมพงษ์"}', '13.7305', '100.5697',  30),
  ('sukhumvit',   '{"zh":"素坤逸","en":"Sukhumvit","th":"สุขุมวิท"}',     '13.7398', '100.5612',  40),
  ('silom',       '{"zh":"是隆","en":"Silom","th":"สีลม"}',               '13.7250', '100.5340',  50),
  ('sathorn',     '{"zh":"沙吞","en":"Sathorn","th":"สาทร"}',             '13.7220', '100.5290',  60),
  ('siam',        '{"zh":"暹罗","en":"Siam","th":"สยาม"}',               '13.7460', '100.5340',  70),
  ('chinatown',   '{"zh":"唐人街","en":"Chinatown","th":"เยาวราช"}',     '13.7400', '100.5096',  80)
) AS x(code, tr, lat, lng, so)
WHERE cities.code = 'bangkok'
ON CONFLICT (city_id, code) DO NOTHING;
