-- 0044 · 第三方服务清单(管理后台可查看的服务明细 + 非密钥参数可配)
-- 来源:packages/db/src/schema/system_integrations.ts
-- 密钥仍走 env(安全);本表存服务元数据/用途/启用开关/非密钥参数/备注,admin 可查看可改非密钥字段。
-- "已配置?"状态由后端实时读 process.env 计算(脱敏),不入库。
-- 上线顺序:先在生产跑本迁移,再 push 代码。

BEGIN;

CREATE TABLE IF NOT EXISTS system_integrations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text        NOT NULL,
  display_name text        NOT NULL,
  category     text        NOT NULL DEFAULT 'other',
  purpose      text        NOT NULL DEFAULT '',
  env_vars     text[]      NOT NULL DEFAULT '{}',
  criticality  text        NOT NULL DEFAULT 'optional',
  docs_url     text,
  config       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  enabled      boolean     NOT NULL DEFAULT true,
  notes        text,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_integrations_key ON system_integrations (key);
CREATE INDEX IF NOT EXISTS idx_system_integrations_sort ON system_integrations (sort_order);

-- 播种平台当前实际用到的 14 个第三方服务(env_vars 第一个为主凭证,用于判定"已配置")
INSERT INTO system_integrations (key, display_name, category, purpose, env_vars, criticality, docs_url, config, sort_order) VALUES
('anthropic','Anthropic Claude','llm','M03 客户 AI 助理主力模型、M06 技师分身代发消息审查;LLM 网关最高优先级路由。',ARRAY['ANTHROPIC_API_KEY'],'critical','https://console.anthropic.com/settings/keys','{"model":"claude-sonnet-4"}'::jsonb,10),
('openai','OpenAI','llm','M03 助理/M06 代发/M04 画像的备用与降级 LLM 通道;也用于 M18 声音降级 TTS(通用女声)。',ARRAY['OPENAI_API_KEY'],'important','https://platform.openai.com/api-keys','{"model":"gpt-4o","ttsModel":"tts-1","ttsVoice":"nova"}'::jsonb,20),
('gemini','Google Gemini','llm','M03 AI 备用 LLM 路由,主通道故障时降级容错。',ARRAY['GOOGLE_GEMINI_API_KEY'],'optional','https://aistudio.google.com/app/apikey','{}'::jsonb,30),
('elevenlabs','ElevenLabs','voice','M18 声音复刻:技师语音克隆 + 多语言 TTS 生成(付费语音、自介语音)。',ARRAY['ELEVENLABS_API_KEY'],'optional','https://elevenlabs.io/app/settings/api-keys','{}'::jsonb,40),
('r2','Cloudflare R2','storage','媒体存储与 CDN:技师头像、相册、聊天图片素材、语音文件;S3 兼容,缺凭证走 stub。',ARRAY['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_URL'],'critical','https://dash.cloudflare.com','{}'::jsonb,50),
('vapid','Web Push (VAPID)','push','浏览器 Web Push 推送:订单状态、预约前提醒、聊天通知。',ARRAY['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'],'important','https://www.npmjs.com/package/web-push','{}'::jsonb,60),
('stripe','Stripe','payment','USD 在线充值支付;缺凭证则充值走 stub。',ARRAY['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PUBLISHABLE_KEY'],'optional','https://dashboard.stripe.com/apikeys','{}'::jsonb,70),
('sentry','Sentry','monitoring','后端错误监控与性能追踪上报;缺 DSN 则 noop。',ARRAY['SENTRY_DSN','SENTRY_ENVIRONMENT','SENTRY_TRACES_SAMPLE_RATE'],'optional','https://sentry.io','{}'::jsonb,80),
('google_maps','Google Maps','geo','GPS 反向地理编码 → 国家/城市/区域,下单地址解析;失败只 log 不阻断。',ARRAY['GOOGLE_MAPS_API_KEY'],'important','https://console.cloud.google.com/google/maps-apis/credentials','{}'::jsonb,90),
('telegram','Telegram Bot','messaging','M17 Telegram 渠道:客户向 bot、Mini App 登录入口、inline 技师分享。',ARRAY['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_MINIAPP_URL','TELEGRAM_BOT_USERNAME'],'important','https://t.me/BotFather','{}'::jsonb,100),
('alert_webhook','通用预警 Webhook','alert','Discord/Slack 通用预警 webhook(严重度 ≥80 触发)。',ARRAY['ALERT_WEBHOOK_URL','ALERT_COOLDOWN_SECONDS'],'optional',NULL,'{}'::jsonb,110),
('alert_telegram','Telegram 预警 Bot','alert','预警系统 Telegram 通道(独立于客户向 bot)。',ARRAY['ALERT_TELEGRAM_BOT_TOKEN','ALERT_TELEGRAM_CHAT_ID'],'optional','https://t.me/BotFather','{}'::jsonb,120),
('resend','Resend 邮件','email','邮件预警 V2(严重度 ≥90 触发),支持多收件人。',ARRAY['RESEND_API_KEY','ALERT_EMAIL_FROM','ALERT_EMAIL_TO'],'optional','https://resend.com/api-keys','{}'::jsonb,130),
('fx','汇率 FX','fx','法币 ↔ 积分换算;汇率存 DB(exchange_rates 表),非 env,在「资金 · 汇率维护」页改。',ARRAY[]::text[],'important',NULL,'{"source":"DB:exchange_rates"}'::jsonb,140)
ON CONFLICT (key) DO NOTHING;

COMMIT;
