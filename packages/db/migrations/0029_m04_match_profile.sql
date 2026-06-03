-- 0029 M04 AI 智能匹配 · 画像采集 + 技师语义画像（地基迁移）
-- 全部为可空加列 · 非破坏性 · 不锁表（无 DEFAULT 回填）
--
-- 客户长期画像(customer_master_preferences,表已存在·只是空):
--   emotional_needs  情绪价值需求(被照顾/被倾听/陪伴解压/社交氛围)· 管道A破冰+管道B对话抽取写入
--   intent_summary   LLM 维护的一句话画像 · 匹配输入 + 可解释来源
-- 技师(therapists):
--   match_persona    "适合什么样的客户"语义画像 · LLM 一次性生成 + 技师可编辑

ALTER TABLE customer_master_preferences
  ADD COLUMN IF NOT EXISTS emotional_needs text[],
  ADD COLUMN IF NOT EXISTS intent_summary text;

ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS match_persona jsonb;
