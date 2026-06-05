-- 0038 · 本单服务方式(到店/上门)· both 技师按单定
-- 来源:packages/db/src/schema/orders.ts(orders.serviceMode)
-- 修 both 技师每单双向交换地址+强逼填址的缺陷:门控/采集/投递改用【本单模式】而非技师模式。
-- 老单 service_mode 为 NULL → 运行时回退技师 serviceMode(兼容,不回填)。
-- 非破坏 · 可空加列 · 幂等 ADD COLUMN IF NOT EXISTS
-- 上线顺序:先在生产跑本迁移,再 push 代码(防部署窗口报列不存在)。

ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_mode text;
