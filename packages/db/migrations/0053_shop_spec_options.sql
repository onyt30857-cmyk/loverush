-- 0053 · 橱窗商品轻量型号/规格(同价同库存)
-- shop_items 加规格名+选项;shop_orders 记录下单所选型号。幂等 ADD COLUMN IF NOT EXISTS。
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS spec_label text;                  -- 规格名(如 颜色/尺寸)
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS spec_options text[] DEFAULT '{}'; -- 选项(如 {S,M,L})
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS selected_spec text;             -- 下单所选型号(轻量,不分价/不分库存)
