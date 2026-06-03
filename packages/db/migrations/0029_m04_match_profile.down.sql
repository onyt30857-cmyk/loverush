-- Rollback for 0029_m04_match_profile.sql
-- ⚠️ Data loss risk: 删除客户情绪需求/画像摘要 + 技师匹配语义画像三列
--    这些列由 LLM 生成/对话沉淀 · 回滚会丢失已采集画像 · 回滚前先 pg_dump

BEGIN;

-- 按 up 的相反顺序删列
ALTER TABLE therapists DROP COLUMN IF EXISTS match_persona;
ALTER TABLE customer_master_preferences DROP COLUMN IF EXISTS intent_summary;
ALTER TABLE customer_master_preferences DROP COLUMN IF EXISTS emotional_needs;

COMMIT;
