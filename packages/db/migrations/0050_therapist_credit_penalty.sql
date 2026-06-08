-- 0050 · 技师信用扣分独立列(放鸽子惩罚持久化)
-- 病根:therapist_no_show 原先直接 scoreService -= 50,但 rating.ts refreshTherapistRating
--       下次有新评价会用评价均值整列覆盖 scoreService → 扣分蒸发。改为独立列累加,refresh 不碰。
-- 标度:credit_penalty 与 scoreService 同为 0-1000 量纲。展示有效分 = max(0, score_service - credit_penalty)。
-- 非破坏 · 幂等 ADD COLUMN IF NOT EXISTS · NOT NULL DEFAULT 0(存量行自动填 0)。
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS credit_penalty integer DEFAULT 0 NOT NULL; -- 累计信用扣分
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS no_show_count integer DEFAULT 0 NOT NULL;  -- 放鸽子次数
