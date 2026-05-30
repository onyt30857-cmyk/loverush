-- 0017 · M06 AI 分身默认开启 · 让功能真正"跑起来"
--
-- 背景:生产 25 技师 0 开启 → 触发条件从未满足 → 分身从未代发(诊断实证)。
--       表/key/代码全齐,唯一缺的是"有人开启"。
-- 动作:① default 0→1(新技师自动具备分身)② 回填存量技师 enabled=1
-- 透明保障:技师端 ContextTrace 可见每条 AI 代发 + 配置页 /t/me/ai-alter 一键关 ·
--           客户端零标识(v5 既定策略,feedback-ai-stealth)
-- 幂等:ALTER SET DEFAULT 可重复 · UPDATE 仅改 0 的行 · 可重复执行
-- 安全:无 DROP · 无建表 · 仅 DEFAULT 变更 + 数据回填。BEGIN/COMMIT 包裹
--
-- 应用:psql "$DATABASE_URL" -f packages/db/migrations/0017_m06_default_enable.sql
--
-- 验证:SELECT count(*) FILTER (WHERE ai_alter_enabled=1) AS 已开启, count(*) AS 技师总数 FROM therapists;

BEGIN;

-- 新技师默认开启
ALTER TABLE therapists ALTER COLUMN ai_alter_enabled SET DEFAULT 1;

-- 回填存量技师(仅改未开启的)
UPDATE therapists SET ai_alter_enabled = 1, updated_at = now() WHERE ai_alter_enabled = 0;

COMMIT;
