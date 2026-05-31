-- 0018 · M06 主动触达 · customer_relationship_profile 加 last_proactive_at
--
-- 用途:记录 AI 上次"主动"触达该客户的时间，做唤回/关怀的频率帽（调研铁律：低频，
--       高频主动 = 骚扰；44% 美消费者收到不到 4 条营销即退订）。区别于 last_interaction_at
--       （含客户主动来访），last_proactive_at 只记 AI 主动发起。
-- 来源:packages/db/src/schema/relationship.ts
-- 幂等:ADD COLUMN / CREATE INDEX IF NOT EXISTS · 可重复
-- 安全:仅 ADD · 无 DROP · 无数据写入
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0018_m06_proactive.sql
-- 验证:SELECT column_name FROM information_schema.columns
--         WHERE table_name='customer_relationship_profile' AND column_name='last_proactive_at';

BEGIN;

ALTER TABLE customer_relationship_profile ADD COLUMN IF NOT EXISTS last_proactive_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_relationship_proactive ON customer_relationship_profile (last_proactive_at);

COMMIT;
