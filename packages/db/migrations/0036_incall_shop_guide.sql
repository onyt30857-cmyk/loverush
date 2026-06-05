-- 0036 · 到店服务 · 门店找店指引 + 到店须知
-- 来源:packages/db/src/schema/therapists.ts(shopGuideMedia / shopArrivalNote)
-- 复用现有 service_address_full_encrypted 存门店完整地址(本迁移不动它)。
-- 非破坏 · 可空加列(jsonb 带 default '[]' / text nullable)· 幂等 ADD COLUMN IF NOT EXISTS
-- 上线顺序:先在生产跑本迁移,再 push 代码(防部署窗口报列不存在)。
-- 注:messages.type 是 text 列(非 enum),'shop_info' 卡片类型无需迁移加值。

ALTER TABLE therapists ADD COLUMN IF NOT EXISTS shop_guide_media jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE therapists ADD COLUMN IF NOT EXISTS shop_arrival_note text;
