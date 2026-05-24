# 生产凭证申请 Runbook

> LoveRush v1 上线前凭证准备 SOP · 11 必填 + 7 可降级
> 配合 `LAUNCH.md §0` 凭证清单 + `scripts/launch-readiness-check.sh` 自检
> 责任人：技术 founder（Tony）· 约 2-3 小时完成全部申请

---

## 0. 申请总览（按耗时排序）

| 优先级 | 服务 | 必填 | 申请耗时 | 月成本预算 |
|---|---|---|---|---|
| P0 | JWT_SECRET 本机生成 | ✅ | 30 秒 | $0 |
| P0 | Anthropic Claude | ✅ | 5 分钟 | $50-300 |
| P0 | OpenAI | ✅ | 5 分钟 | $30-200 |
| P0 | Supabase（新加坡区）| ✅ | 10 分钟 | $25-100 |
| P0 | Cloudflare R2 + Workers | ✅ | 15 分钟 | $5-30 |
| P0 | Upstash Redis | ✅ | 5 分钟 | $0-50 |
| P1 | Google Gemini | 可降级 | 5 分钟 | $0-30 |
| P1 | Stripe | 可降级 | 30 分钟（含 KYC）| 2.9% + $0.30/笔 |
| P1 | VAPID（Web Push）| 可降级 | 1 分钟（本机生成）| $0 |
| P1 | Sentry | 可降级 | 5 分钟 | $0-26 |
| P1 | Resend（邮件）| 可降级 | 5 分钟 | $0-20 |
| P2 | Twilio（SMS OTP）| 可降级 | 15 分钟（需充值）| $0.04/SMS |
| P2 | DeepL（翻译）| 可降级 | 10 分钟 | $0-25 |
| P2 | Telegram Bot | 可降级 | 3 分钟 | $0 |
| P3 | ElevenLabs（声音）| 可降级 | 5 分钟 | $0-30 |
| P3 | AWS Rekognition | 可降级 | 30 分钟（IAM 学习曲线）| $0.001/张 |
| P3 | Adyen（东南亚支付）| 可降级 | 1-2 天（KYC 审核）| 2.5% + €0.10/笔 |

**月度预算合计**：MVP 阶段 **$140-790**（取决于流量）

**关键路径**：P0 凭证全部就位 = 可上线（其他都 stub 自动降级）。

---

## 1. 本机生成（30 秒）

### 1.1 JWT_SECRET

JWT 签名密钥，必须 ≥ 32 字符随机串。

```bash
openssl rand -hex 32
# 输出示例：a3f9d2c8b1e5f7a4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2
```

**写入** `.env.production`：
```bash
JWT_SECRET=<上面输出>
JWT_ISSUER=loverush
JWT_ACCESS_TTL=1h
JWT_REFRESH_TTL=30d
```

### 1.2 VAPID 密钥对（Web Push）

```bash
npx web-push generate-vapid-keys
# 输出：
# Public Key:  BNxxxxxx...
# Private Key: yyyyyyy...
```

**写入**：
```bash
VAPID_PUBLIC_KEY=BNxxxxxx...
VAPID_PRIVATE_KEY=yyyyyyy...
VAPID_SUBJECT=mailto:noreply@loverush.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BNxxxxxx...   # 同 VAPID_PUBLIC_KEY · 前端用
```

**注意**：`VAPID_PUBLIC_KEY` 一旦发布给客户端不可换（订阅者要重新订阅）。轮换周期 365 天。

---

## 2. P0 凭证（必填 · 否则不能上线）

### 2.1 Anthropic Claude

**用途**：T1 主对话 / T2 翻译 / T3 仲裁分类（详 `packages/llm/README.md`）。

**步骤**：
1. 打开 https://console.anthropic.com/
2. 注册账号（推荐用工作邮箱，防止个人邮箱被封）
3. 左侧 **API Keys** → **Create Key**
4. 命名 `loverush-production` → Create
5. 复制 key（格式 `sk-ant-xxxxx`，**仅显示一次**）
6. 充值：右上角 **Billing** → 加 credits（建议先充 $50 试水）

**写入**：
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

**验证**：
```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-haiku-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
# 期望返回 200 + content
```

**成本**：
- Sonnet 4.5：$3/1M input + $15/1M output
- Haiku 4.5：$0.8/1M input + $4/1M output
- Opus 4.7：$15/1M input + $75/1M output
- MVP 阶段（500 客户 × 10 次 AI 对话/天）≈ $50-150/月

### 2.2 OpenAI（降级备 + Whisper ASR）

**步骤**：
1. https://platform.openai.com/api-keys
2. 注册 → 充值 $20 起步
3. **Create new secret key** → 名 `loverush-prod`
4. 复制 key（格式 `sk-proj-xxxxx`）

**写入**：
```bash
OPENAI_API_KEY=sk-proj-xxxxx
```

**验证**：
```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

**成本**：
- gpt-4o-mini：$0.15/1M in + $0.6/1M out（降级备路径）
- Whisper：$0.006/分钟（v2 语音转写时启用）

### 2.3 Supabase（PostgreSQL · 新加坡区）

**用途**：主数据库 · PDPA 合规要求东南亚数据本地化（PRD §9.4）。

**步骤**：
1. https://supabase.com/dashboard
2. 注册 → **New Project**
3. 填：
   - Name: `loverush-production`
   - Database Password: 用 `openssl rand -hex 16` 生成强密码 · 存 1Password
   - **Region: Singapore (ap-southeast-1)** ← 关键
   - Pricing: Pro $25/月（必选 · Free tier 不能用于生产）
4. 等 2-3 分钟创建完成
5. 左侧 **Settings → Database**
6. 复制两个 connection string：
   - **Connection pooling (Transaction mode)** → `DATABASE_URL`（应用走这个）
   - **Direct connection** → `DATABASE_URL_DIRECT`（migration 走这个）

**写入**：
```bash
DATABASE_URL=postgresql://postgres.xxxxxxxx:<password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
DATABASE_URL_DIRECT=postgresql://postgres.xxxxxxxx:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

**验证**（需先装 libpq）：
```bash
brew install libpq && export PATH=/opt/homebrew/opt/libpq/bin:$PATH
psql "$DATABASE_URL" -c "SELECT version();"
# 期望返回 PostgreSQL 15.x ...
```

**成本**：Pro $25/月（含 8GB DB + 100GB egress）· MVP 阶段够用

### 2.4 Cloudflare R2 + Workers + Pages

**用途**：
- R2 = 媒体存储（头像 / 视频 / 录屏）· S3 兼容 · **无 egress 费**
- Workers = API 部署（边缘 · 全球低延迟）
- Pages = 前端部署（Next.js）

**步骤**：

#### 4.1 注册 + 域名
1. https://dash.cloudflare.com/
2. 注册 → 添加域名 `loverush.com`（或你的域名）→ 改 NS 到 Cloudflare
3. 等 DNS 接管完成（5-30 分钟）

#### 4.2 R2 bucket
4. 左侧 **R2 Object Storage** → **Create bucket**
5. Name: `loverush-media` · Location: APAC（自动选最近）
6. 创建后 → **Settings → Public access** → 接入自定义域 `media.loverush.com`
7. **Manage R2 API tokens** → **Create API token**
   - Permission: **Object Read & Write**
   - Bucket: `loverush-media`
8. 复制三个值：
   - Access Key ID
   - Secret Access Key
   - Account ID（仪表盘右下角）

**写入**：
```bash
R2_ACCOUNT_ID=<32 字符>
R2_ACCESS_KEY_ID=<32 字符>
R2_SECRET_ACCESS_KEY=<64 字符>
R2_BUCKET_NAME=loverush-media
R2_PUBLIC_URL=https://media.loverush.com
```

**验证**：
```bash
aws s3 ls s3://loverush-media \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com \
  --region auto
# 期望返回空列表（bucket 存在）
```

#### 4.3 Workers + Pages（部署时再装）
- Workers / Pages 用 `wrangler` CLI 部署（`scripts/deploy-production.sh` 自动调用）
- 首次运行 `wrangler login` 浏览器授权即可，**不需要单独的 token**

**成本**：
- R2: $0.015/GB/月 存储 + $0 出口费 + $4.5/百万次请求 → MVP 约 $5/月
- Workers: $5/月（10M 请求免费 + Bundled plan）
- Pages: 免费

### 2.5 Upstash Redis（限流 + 缓存）

**用途**：
- 限流（`@upstash/ratelimit`）
- 幂等性键
- session 缓存（可选）

**步骤**：
1. https://console.upstash.com/
2. 注册（建议用 GitHub OAuth）
3. **Create Database** → Redis
4. 配置：
   - Name: `loverush-prod`
   - Region: **AWS Singapore (ap-southeast-1)** ← 与 Supabase 同区域
   - Type: Regional（Pay as you go）
5. 进入数据库 → **REST API** 标签
6. 复制：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

**写入**：
```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=Axxxxxxxxxx
REDIS_URL=rediss://default:<token>@xxx.upstash.io:6379    # 兼容路径（可选）
```

**验证**：
```bash
curl -X POST $UPSTASH_REDIS_REST_URL/set/health/ok \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
# 期望返回 {"result":"OK"}
```

**成本**：免费额度 10000 命令/天 · MVP 阶段够用 · 超出 $0.2/100k 命令

---

## 3. P1 凭证（可降级 · 缺时业务自动 stub）

### 3.1 Google Gemini（T2 备路径）

**步骤**：
1. https://aistudio.google.com/app/apikey
2. 用 Google 账号登录
3. **Get API Key** → **Create API key in new project**
4. 复制 key

**写入**：
```bash
GOOGLE_GEMINI_API_KEY=AIzaxxxxxx
```

**成本**：
- Gemini Flash 免费层 15 RPM
- 付费层 $0.075/1M in + $0.30/1M out

### 3.2 Stripe（支付主通道）

**用途**：客户充值积分。Stripe payment_intent ID 是 `pi_xxxxx` 字符串（**v0.32.0 已修 DB 类型从 uuid 改 text**）。

**步骤**：
1. https://dashboard.stripe.com/register
2. 注册 → **填 KYC 信息**（公司主体 / 法人 / 银行账户）
3. 等待 1-3 天审核（先用 Test mode 开发）
4. 切到 **Test mode**（右上角开关）
5. **Developers → API keys** → 复制：
   - Publishable key (`pk_test_xxx`)
   - Secret key (`sk_test_xxx`)
6. **Developers → Webhooks** → **Add endpoint**
   - URL: `https://api.loverush.com/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
   - 复制 Signing secret (`whsec_xxx`)

**写入**：
```bash
STRIPE_SECRET_KEY=sk_test_xxxxx        # Test mode 开发用 · 上线切 sk_live_
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
```

**验证**：
```bash
curl https://api.stripe.com/v1/balance -u $STRIPE_SECRET_KEY:
# 期望返回 200 JSON
```

**Test mode → Live mode 切换**：
1. 审核通过后切 Live mode
2. **Developers → API keys** 复制 live keys（`sk_live_xxx`）
3. 重建 webhook endpoint（Live mode 的 webhook 独立）
4. 替换 `.env.production` 的 keys

**成本**：2.9% + $0.30/笔（标准费率）· 跨境额外 1.5%

### 3.3 Sentry（错误监控）

**步骤**：
1. https://sentry.io/signup/
2. 注册 → **Create Project**
3. Platform: **Node.js**（API）+ **Next.js**（web/admin）
4. 拿 DSN（每个 project 独立 DSN）

**写入**：
```bash
SENTRY_DSN=https://xxx@oxxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_RELEASE=v0.33.0
NEXT_PUBLIC_SENTRY_DSN=<同上>
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
```

**成本**：免费 5k events/月 · Team 计划 $26/月（50k events）

### 3.4 Resend（邮件 OTP / 通知）

**步骤**：
1. https://resend.com/
2. 注册 → 验证 sending domain（loverush.com）
3. **API Keys → Create** → 复制 `re_xxx`

**写入**：
```bash
RESEND_API_KEY=re_xxxxx
```

**成本**：免费 100 封/天 · Pro $20/月（50k 封）

---

## 4. P2 凭证（功能性 · 缺时该功能不可用但不阻塞主流程）

### 4.1 Twilio（SMS OTP）

**用途**：手机号注册的 OTP 短信。东南亚号段成本高。

**步骤**：
1. https://www.twilio.com/console
2. 注册 → 验证手机号
3. **充值 $20**（最低）
4. **Phone Numbers → Buy a number**（选 SMS-enabled 号码 · 推荐美国号便宜）
5. 拿到三个值：
   - Account SID
   - Auth Token
   - From Number

**写入**：
```bash
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

**成本**：
- 美国 → 泰国 SMS：约 $0.05/条
- 美国 → 中国 SMS：约 $0.08/条
- MVP 阶段（500 注册/月 × $0.05）= $25/月

**降级方案**：开 `LAUNCH.md` 说的"邀请码强制入场 + 仅密钥/TG 登录"，跳过 SMS OTP，零成本。

### 4.2 DeepL（翻译主路径 · 缺降级 Claude）

**步骤**：
1. https://www.deepl.com/pro-api
2. 注册 **DeepL API Free**（50 万字符/月免费）或 **Pro**
3. **Account → DeepL API → Authentication Key** → 复制

**写入**：
```bash
DEEPL_API_KEY=xxxxx:fx     # Free 版后缀 :fx
```

**成本**：
- Free：50 万字符/月 = 0
- Pro：$5.49/月起，超出 $20/100 万字符
- 比 Claude 翻译质量略好 · 成本低很多

### 4.3 Telegram Bot（TG Mini App）

**步骤**：
1. 在 Telegram 打开 @BotFather
2. `/newbot` → 命名 `LoveRush` → 拿 token
3. `/newapp` 设置 Mini App（指向 `https://app.loverush.com`）
4. `/setdomain` 配置域名白名单

**写入**：
```bash
TELEGRAM_BOT_TOKEN=8xxxx:AAxxxxxxxxxxxxx
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>     # 自己定 · 后续 setWebhook 时用
```

**成本**：$0（Telegram Bot API 完全免费）

---

## 5. P3 凭证（v2 用 · v1 可缺）

### 5.1 ElevenLabs（声音复刻）

**用途**：M06 AI 分身的声音复刻（v2 启用 · v1 走文字）。

**步骤**：
1. https://elevenlabs.io/
2. 注册 → **Profile → API Key**

**写入**：
```bash
ELEVENLABS_API_KEY=sk_xxxxx
```

**成本**：免费 10k 字符/月 · Pro $22/月

### 5.2 AWS Rekognition（真人核验）

**用途**：M02 技师入驻的人脸活体检测（Phase 2 POC）。

**步骤**：
1. https://aws.amazon.com/console
2. 注册 → 验证信用卡
3. **IAM → Users → Add user**
   - 命名 `loverush-rekognition`
   - Programmatic access ✓
4. **Attach policies → AmazonRekognitionFullAccess**
5. **Create access key** → 复制
6. 进 **Rekognition Console** 启用 service in `ap-southeast-1`

**写入**：
```bash
AWS_ACCESS_KEY_ID=AKIAxxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
AWS_REGION=ap-southeast-1
```

**成本**：
- DetectFaces：$0.001/张
- CompareFaces：$0.001/张
- MVP 阶段（500 入驻 × 3 张）= $1.5/月（极便宜）

### 5.3 Adyen（东南亚支付备路径）

**用途**：Stripe 在某些东南亚国家不覆盖时的备路径。

**步骤**：
1. https://www.adyen.com/signup
2. 注册公司账号 → **KYC 审核 1-2 天**
3. **Account → API credentials → Generate API Key**

**写入**：
```bash
ADYEN_API_KEY=AQExxxxxxxxxxx
ADYEN_MERCHANT_ACCOUNT=LoveRushECOM
```

**成本**：2.5% + €0.10/笔

---

## 6. 完整 `.env.production` 模板

按申请顺序填齐。**不要进 git**（已在 .gitignore）：

```bash
# Runtime
NODE_ENV=production

# Database (Supabase Singapore)
DATABASE_URL=postgresql://postgres.xxxxx:xxxxx@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
DATABASE_URL_DIRECT=postgresql://postgres.xxxxx:xxxxx@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres

# Redis (Upstash)
REDIS_URL=rediss://default:xxxxx@xxx.upstash.io:6379
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=Axxxxxxxxxx

# Auth
JWT_SECRET=<openssl rand -hex 32>
JWT_ISSUER=loverush
JWT_ACCESS_TTL=1h
JWT_REFRESH_TTL=30d

# LLM
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-proj-xxxxx
GOOGLE_GEMINI_API_KEY=AIzaxxxxx

# Cloudflare R2
R2_ACCOUNT_ID=xxxxx
R2_ACCESS_KEY_ID=xxxxx
R2_SECRET_ACCESS_KEY=xxxxx
R2_BUCKET_NAME=loverush-media
R2_PUBLIC_URL=https://media.loverush.com

# Payment
STRIPE_SECRET_KEY=sk_live_xxxxx       # 上线前切 live
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx

# Web Push (本机生成)
VAPID_PUBLIC_KEY=BNxxxxx
VAPID_PRIVATE_KEY=xxxxx
VAPID_SUBJECT=mailto:noreply@loverush.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BNxxxxx

# Monitoring
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_RELEASE=v0.33.0

# Notifications (可选)
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
RESEND_API_KEY=re_xxxxx
TELEGRAM_BOT_TOKEN=xxxxx:xxxxx
TELEGRAM_WEBHOOK_SECRET=xxxxx

# Translation (可选)
DEEPL_API_KEY=xxxxx:fx

# v2 用 (可缺)
ELEVENLABS_API_KEY=sk_xxxxx
AWS_ACCESS_KEY_ID=AKIAxxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
AWS_REGION=ap-southeast-1

# Public (Next.js)
NEXT_PUBLIC_API_URL=https://api.loverush.com
NEXT_PUBLIC_R2_PUBLIC_URL=https://media.loverush.com
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_SENTRY_RELEASE=v0.33.0
```

---

## 7. 凭证安全规则

### 7.1 存储

- **生产凭证用 `wrangler secret` 注入 Cloudflare Workers**，**不写在 wrangler.toml**：
  ```bash
  cd code && wrangler secret put DATABASE_URL --env production
  # 提示后粘贴值
  ```
- **VPS 部署**：`.env.production` 放 `/etc/loverush/api.env`，systemd EnvironmentFile 引用，权限 `chmod 600` + 属主 root
- **本地 backup**：1Password / Bitwarden vault，名 `LoveRush-prod`
- **绝不进 git**：`.env*` 已 .gitignore，但仍要 `git ls-files | grep env` 双检

### 7.2 轮换周期（对齐 `LAUNCH.md §6`）

| 凭证 | 周期 | 备注 |
|---|---|---|
| `JWT_SECRET` | 90 天 | 轮换前预留 7 天双 secret 并行期 |
| `VAPID_*` | 365 天 | 客户端会自动重新订阅 |
| `R2_ACCESS_KEY*` | 180 天 | Cloudflare R2 控制台支持双 key 并行 |
| LLM API keys | 180 天 | wrangler secret put 替换 |
| `STRIPE_*` | 不主动轮换，仅泄露时立即 | webhook secret 单独管理 |

### 7.3 泄露应急

发现凭证泄露（GitHub push 公开 / Slack 截图 / 浏览器历史）：

1. **立即 revoke 老 key**：
   - Anthropic / OpenAI / Stripe / etc 控制台 "Revoke key"
2. **生成新 key + 部署**：`wrangler secret put` + 触发部署
3. **审计**：
   - 看 `loverush_llm_cost_usd_total` 突增
   - 看 `loverush_audit_events_24h` 异常 actor
4. **通知**：Sentry alert + Slack #incidents

---

## 8. 上线前自检

凭证全部就位后，跑：

```bash
cd /Users/tony/Desktop/我的项目/为爱冲锋/code
ENV_FILE=.env.production bash scripts/launch-readiness-check.sh
```

期望最末输出：
```
PASS 19  WARN 0  FAIL 0
READY=GO（可进入 LAUNCH.md §7 D-Day 流程）
```

任何 FAIL → 回看本 runbook 对应章节补全。

---

## 9. 配对文档

| 文档 | 用途 |
|---|---|
| 本 runbook | 凭证申请详细步骤 |
| `LAUNCH.md §0` | 凭证清单（高层）|
| `LAUNCH.md §6` | 轮换周期 |
| `scripts/launch-readiness-check.sh` | 自检凭证 / DB / API |
| `docs/runbooks/d-day-playbook.md` | 上线日逐小时清单 |
| `.env.example` | 字段全列表（保留作为 schema 参考）|

---

**最后更新**：2026-05-22（Phase 35 · 上线 10% 收尾）
