-- M16 · 修复 points_txn_type 枚举漂移 + P1 回收预留
--
-- 背景:代码 schema 早已定义 AGENT_WHOLESALE/AGENT_SELL/AGENT_BUY,但生产库
-- points_txn_type 枚举从未加上这三个值 → 代理批发/卖出时 credit('AGENT_WHOLESALE')
-- 写库 enum 校验失败 → 事务回滚 → M16 整条链从没跑通一笔。本迁移补齐。
-- 顺带把 P1 回收链路要用的 AGENT_REDEEM_OUT/AGENT_REDEEM_IN 一并加上(省一次迁移)。
--
-- 注意:PostgreSQL 的 ALTER TYPE ... ADD VALUE 不能在事务块内执行,且新值在同一
-- 事务内不可立即使用。故逐条独立、用 psql -f 直接跑(默认每条自动提交),不要包 BEGIN/COMMIT。
-- ADD VALUE 不可逆(PG 不支持 DROP VALUE),但幂等且无害,无 down。

ALTER TYPE points_txn_type ADD VALUE IF NOT EXISTS 'AGENT_WHOLESALE';
ALTER TYPE points_txn_type ADD VALUE IF NOT EXISTS 'AGENT_SELL';
ALTER TYPE points_txn_type ADD VALUE IF NOT EXISTS 'AGENT_BUY';
ALTER TYPE points_txn_type ADD VALUE IF NOT EXISTS 'AGENT_REDEEM_OUT';
ALTER TYPE points_txn_type ADD VALUE IF NOT EXISTS 'AGENT_REDEEM_IN';
