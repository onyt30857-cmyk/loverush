-- 0010 · M02 Phase 4 搜索后台 · down
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0010_search_admin.down.sql
-- 注意:DROP CASCADE 会一并删除运营配的所有热门词和类目数据 · 操作前备份

BEGIN;

DROP TABLE IF EXISTS search_query_logs CASCADE;
DROP TABLE IF EXISTS search_hot_keywords CASCADE;
DROP TABLE IF EXISTS search_categories CASCADE;

COMMIT;
