-- 0044 · 技师评分科学化 · 贝叶斯加权分列
-- 来源:packages/db/src/schema/therapists.ts(ratingBayes)
-- 非破坏 · 可空加列默认 0 · 幂等 ADD COLUMN IF NOT EXISTS
-- 上线顺序:先在生产跑本迁移,再 push 代码(防部署窗口报列不存在)。
-- 用途:ratingBayes = 贝叶斯收缩 + 时间衰减后的服务分(0-1000),用于排序与展示主值;
--       杜绝"1 条满分新技师排在多条高分老技师之前"。回填脚本 backfill-rating-bayes.mts 跑一次。

ALTER TABLE therapists ADD COLUMN IF NOT EXISTS rating_bayes integer NOT NULL DEFAULT 0;

-- 排序索引(列表/推荐按贝叶斯分降序)
CREATE INDEX IF NOT EXISTS idx_therapists_rating_bayes ON therapists (rating_bayes);
