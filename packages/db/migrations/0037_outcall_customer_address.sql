-- 0037 · 上门服务 · 客户上门地址(投递给技师)
-- 来源:packages/db/src/schema/orders.ts(customerAddress / customerAddressNote / customerAddressMedia / customerLat / customerLng / customerAreaName)
-- 到店(0036 shopInfo)的镜像 —— 到店是技师店址,本功能是客户上门址,各自独立。
-- 非破坏 · 可空加列(text nullable / jsonb 带 default '[]')· 幂等 ADD COLUMN IF NOT EXISTS
-- 上线顺序:先在生产跑本迁移,再 push 代码(防部署窗口报列不存在)。
-- 注:messages.type 是 text 列(非 enum),'customer_location' 卡片类型无需迁移加值。

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_address_note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_address_media jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_lat text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_lng text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_area_name text;
