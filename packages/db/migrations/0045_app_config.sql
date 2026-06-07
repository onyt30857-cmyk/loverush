-- 0045 · 小程序运营配置(app_config KV) · B1 bot文案 + B2 首页运营 + B3 底部导航
-- 来源:packages/db/src/schema/app_config.ts
-- 一张 KV 表承载三域配置(key 唯一,value jsonb)。播种当前硬编码值做初始内容(改前与现状一致)。
-- 前端读取带硬编码 fallback(永不假装数据);bot.* 仅服务端读不下发 C 端。
-- 上线顺序:先在生产跑本迁移,再 push 代码。

BEGIN;

CREATE TABLE IF NOT EXISTS app_config (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text        NOT NULL,
  scope      text        NOT NULL DEFAULT 'general',
  label      text,
  value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  enabled    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_config_key ON app_config (key);
CREATE INDEX IF NOT EXISTS idx_app_config_scope ON app_config (scope);

INSERT INTO app_config (key, scope, label, value) VALUES
('bot.texts','bot','Bot 文案','{"welcomeMessage":"想找放松一下？点下面打开看看吧～","startButton":"打开 App","inlineButton":"打开 App 浏览全部","bookButton":"在 App 内约 →","notFound":"没找到这位技师，换一个试试～"}'::jsonb),
('bot.commands','bot','Bot 命令菜单','{"commands":[{"command":"start","description":"打开 LoveRush · 找放松"}]}'::jsonb),
('home.promise','home','首页承诺区','{"subtitle":"Why LoveRush","title":"28,000+ 男人的私选","items":[{"title":"语言不通也能撩","sub":"中/英/泰/越/马/印 · 实时翻译"},{"title":"越用越懂你的口味","sub":"第 2 次起精准命中 · 不走弯路"},{"title":"绝对隐身 · 谁也不知道","sub":"分级隐私 · 计算器伪装 · 一键隐身"}]}'::jsonb),
('home.brandFooter','home','首页品牌脚注','{"wordmark":"LOVERUSH","tagline":"东南亚 · 男人的私选清单"}'::jsonb),
('nav.customer','nav','底部导航(客户)','{"tabs":[{"key":"discover","label":"发现","enabled":true,"order":1},{"key":"messages","label":"私聊","enabled":true,"order":2},{"key":"assistant","label":"助理","enabled":true,"order":3},{"key":"orders","label":"预约","enabled":true,"order":4},{"key":"me","label":"我的","enabled":true,"order":5}]}'::jsonb),
('nav.therapist','nav','底部导航(技师)','{"tabs":[{"key":"home","label":"工作台","enabled":true,"order":1},{"key":"orders","label":"订单","enabled":true,"order":2},{"key":"schedule","label":"排班","enabled":true,"order":3},{"key":"messages","label":"私聊","enabled":true,"order":4},{"key":"me","label":"我的","enabled":true,"order":5}]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
