-- 0046 · 评价体验向多维(P1)· reviews 加 总分 + 态度/真人符合度/守时 维度
-- 来源:packages/db/src/schema/reviews.ts
-- 非破坏 · 可空加列(存量行无值;新评价 app 层必填 score_overall)· 幂等 ADD COLUMN IF NOT EXISTS
-- 上线顺序:先在生产跑本迁移,再 push 代码。
-- 标度:0-100(5 星 ×20)。颜值/身材(score_appearance/score_body)停采但列保留兼容。
-- 贝叶斯主分由 score_service 切换到 score_overall(引擎对 null 回退 score_service)。

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS score_overall integer;       -- 总分(必填·app层)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS score_attitude integer;      -- 态度
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS score_authenticity integer;  -- 真人符合度(防照骗)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS score_punctuality integer;   -- 守时
