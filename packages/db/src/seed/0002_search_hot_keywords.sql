-- ═══════════════════════════════════════════════
-- LoveRush · 搜索热门词 · 冷启动种子 8 个
-- 执行：psql $DATABASE_URL -f packages/db/src/seed/0002_search_hot_keywords.sql
--
-- 时机:刚上线 search_hot_keywords 表为空 · 前端走 fallback
--      灌完后 admin /search/keywords 可见 8 个可编辑条目
-- 原则:全 locales/cities 通投 · enabled=1 · 永久(无 startsAt/endsAt)
-- 幂等:ON CONFLICT (keyword) DO NOTHING · 可重复执行
-- ═══════════════════════════════════════════════

INSERT INTO search_hot_keywords (keyword, display_label, sort_order, enabled) VALUES
  ('thai',         '泰式',      10,  1),
  ('oil',          '油压',      20,  1),
  ('tonight',      '今晚有空',  30,  1),
  ('sukhumvit',    '素坤逸',    40,  1),
  ('zh',           '中文',      50,  1),
  ('top-rated',    '评分高',    60,  1),
  ('newbie',       '新人',      70,  1),
  ('online-now',   '在线',      80,  1)
ON CONFLICT (keyword) DO NOTHING;
