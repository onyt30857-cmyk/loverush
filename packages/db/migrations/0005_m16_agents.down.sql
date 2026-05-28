-- 0005 · M16 积分代理分销 · ROLLBACK(慎用,会丢业务数据)
-- 仅当要彻底卸下 M16 时执行,顺序为表 → 索引(随表删)→ 类型

BEGIN;

DROP TABLE IF EXISTS point_purchase_orders        CASCADE;
DROP TABLE IF EXISTS agent_wholesale_orders       CASCADE;
DROP TABLE IF EXISTS agent_customer_assignment    CASCADE;
DROP TABLE IF EXISTS agent_payment_methods        CASCADE;
DROP TABLE IF EXISTS agent_profiles               CASCADE;

DROP TYPE IF EXISTS point_purchase_status;
DROP TYPE IF EXISTS agent_wholesale_status;
DROP TYPE IF EXISTS agent_payment_method_type;

COMMIT;
