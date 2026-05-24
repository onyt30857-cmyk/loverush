# DEPLOY.md · 部署手册

> 从零到 D-Day 上线的完整部署 SOP。  
> 主路径：**Supabase（DB）+ Bun on Vultr（API）+ Cloudflare Pages（web/admin）+ Cloudflare R2（媒体）**。  
> 上线运行手册见 `LAUNCH.md`，技术债见 `v1/TECH-DEBT.md`。

---

## 0. 部署架构

```
   客户端                                                      
   ┌──────────────┐                                            
   │  H5 浏览器    │ ─────┐                                     
   └──────────────┘      │   ┌──────────────────────────────┐  
                         ├──▶│   Cloudflare（DNS + CDN）     │  
   ┌──────────────┐      │   │   - loverush.com   → Pages   │  
   │  PWA / TG    │ ─────┘   │   - admin.*        → Pages   │  
   └──────────────┘          │   - api.*          → Vultr   │  
                             │   - media.*        → R2      │  
                             └──┬──────────────┬────────────┘  
                                │              │               
                                ▼              ▼               
                    ┌──────────────────┐   ┌──────────┐         
                    │  Vultr / DO      │   │  R2      │         
                    │  ┌────────────┐  │   │  bucket  │         
                    │  │ nginx :443 │  │   └──────────┘         
                    │  └─────┬──────┘  │                        
                    │        │         │                        
                    │  ┌─────▼──────┐  │      ┌──────────┐      
                    │  │ Bun api    │──┼─────▶│ Supabase │      
                    │  │ :8787      │  │      │   PG     │      
                    │  └────────────┘  │      └──────────┘      
                    │                  │                        
                    │  ┌────────────┐  │      ┌──────────┐      
                    │  │ admin :3001│  │  ───▶│  Upstash │      
                    │  └────────────┘  │      │  Redis   │      
                    └──────────────────┘      └──────────┘      
```

---

## 1. 凭证准备清单

按下表全部就位再启动：

### 1.1 Supabase（PG · Singapore region）

1. https://supabase.com → New Project（Region: `Southeast Asia (Singapore)`）
2. Settings → Database → Connection string（Pooler · session mode）→ `DATABASE_URL`
3. Settings → Database → Backups 改为每日备份

### 1.2 Upstash Redis（幂等 + 限流）

1. https://console.upstash.com → Create Database（Singapore region）
2. 复制 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

### 1.3 Vultr / DigitalOcean（API 主机）

- 实例规格：2 vCPU / 4G RAM / 80G SSD（起步够用）
- OS：Ubuntu 22.04 LTS
- Region：Singapore（与 Supabase 同区减少延迟）
- 启用 IPv6 + Backup

### 1.4 Cloudflare（DNS / CDN / R2 / Pages）

按 LAUNCH.md §0 配齐：
- VAPID 公私钥
- R2 bucket + access key
- Pages 自定义域 `loverush.com` / `admin.loverush.com` / `api.loverush.com` / `media.loverush.com`
- Access 策略（admin 强制邮箱白名单）

### 1.5 Stripe

1. Dashboard → Developers → API keys → `STRIPE_SECRET_KEY`
2. Webhooks → Add endpoint：`https://api.loverush.com/webhooks/stripe`，订阅 `payment_intent.succeeded` → 拿 `STRIPE_WEBHOOK_SECRET`

### 1.6 Sentry

1. https://sentry.io → Create Project（Platform: Node）→ API 用的 DSN
2. 再 Create Project（Platform: Next.js）→ Web 用的 DSN（NEXT_PUBLIC_）

### 1.7 LLM

- Anthropic Console → API Key → `ANTHROPIC_API_KEY`
- OpenAI（备）+ Gemini（备）按需

---

## 2. 数据库初始化

```bash
# 本机
cd code
cp .env.example .env.production
# 填 Supabase DATABASE_URL + 其他

DATABASE_URL=<supabase_url> pnpm --filter @loverush/db generate
DATABASE_URL=<supabase_url> pnpm --filter @loverush/db migrate
DATABASE_URL=<supabase_url> pnpm --filter @loverush/db seed
```

验证：
```bash
psql $DATABASE_URL -c "\dt" | wc -l
# 期望 ≥ 60
psql $DATABASE_URL -c "SELECT code FROM invite_codes;"
# 应看到 3 个 ADMIN-SEED-* 邀请码
```

---

## 3. API 部署（Bun on Vultr）

```bash
# 1. SSH 上 Vultr
ssh root@<vultr_ip>

# 2. 装 Bun + 创建用户
curl -fsSL https://bun.sh/install | bash
useradd -r -m -s /bin/bash loverush
sudo -u loverush curl -fsSL https://bun.sh/install | sudo -u loverush bash

# 3. 拉代码
mkdir -p /opt/loverush && chown loverush: /opt/loverush
sudo -u loverush git clone https://github.com/<your-org>/loverush.git /opt/loverush
cd /opt/loverush/code
sudo -u loverush pnpm install --frozen-lockfile=false

# 4. 准备生产 env
sudo -u loverush cp .env.example .env.production
sudo -u loverush vim .env.production  # 填齐凭证

# 5. systemd 起服务
sudo cp infra/systemd/loverush-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now loverush-api
sudo journalctl -u loverush-api -f  # 看启动日志
```

### Nginx 反代

```bash
sudo apt install -y nginx
sudo cp infra/nginx/loverush.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/loverush.conf /etc/nginx/sites-enabled/

# Cloudflare origin certificate
sudo mkdir /etc/ssl/cloudflare
# 把 Cloudflare → SSL/TLS → Origin Server → Create Certificate 出的 pem/key 放进去
sudo nginx -t && sudo systemctl reload nginx
```

### Cloudflare DNS

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A    | api  | `<vultr_ipv4>` | 🟠 Proxied |
| AAAA | api  | `<vultr_ipv6>` | 🟠 Proxied |

健康检查：`curl https://api.loverush.com/ping`

---

## 4. Web 部署（Cloudflare Pages）

按 `infra/cloudflare/pages.md` 配置 Pages project。

简版操作：
1. Dashboard → Pages → Create Pages → Connect to Git → 选 loverush 仓库
2. Build command: `pnpm install --frozen-lockfile=false && pnpm --filter @loverush/web build`
3. Build output: `apps/web/.next`
4. Environment variables：按 pages.md 表格填 `NEXT_PUBLIC_*` 系列
5. Custom domains: `loverush.com` + `www.loverush.com`

---

## 5. Admin 部署（Cloudflare Pages + Access）

同 Web，build 命令换 `@loverush/admin`，自定义域 `admin.loverush.com`。

⚠️ **必须加 Cloudflare Access 策略**（pages.md §5），否则后台暴露在公网。

---

## 6. R2 媒体存储

```bash
# Cloudflare Dashboard
# 1. R2 → Create bucket "loverush-media"
# 2. Bucket → Settings → Public access → Connect Custom Domain → media.loverush.com
# 3. R2 → Manage API Tokens → Create token：
#    - Permissions: Object Read & Write
#    - Specify bucket: loverush-media
#    - 复制 Access Key ID / Secret Access Key → 填入 .env.production
```

CORS 规则（让 H5 能直传）：
```json
[
  {
    "AllowedOrigins": ["https://loverush.com", "https://www.loverush.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## 7. 创建第一个 admin

```bash
# 在客户端注册一个普通用户 → 保存助记词 + 得到 user_id

# 服务端 SQL 赋权
psql $DATABASE_URL -c "INSERT INTO user_roles (user_id, role) VALUES ('<your-user-uuid>', 'admin');"

# 用助记词登 admin.loverush.com，应该能看到完整后台
```

---

## 8. D-Day 启动 checklist

按顺序逐项打勾：

### Pre-flight（D-7 至 D-1）

- [ ] Supabase 创建 + 备份策略生效
- [ ] Upstash Redis 创建
- [ ] Vultr 实例就绪 + nginx + systemd 起来
- [ ] Cloudflare DNS + Pages + R2 配置
- [ ] Stripe webhook endpoint 注册 + secret 拿到
- [ ] Sentry 两个 project 创建（API + Web）
- [ ] LLM API key 全套就位
- [ ] 数据库 schema 推送 + seed
- [ ] 第一个 admin user 创建
- [ ] 内测 5 人 override：`POST /admin/flags/<key>/overrides`
- [ ] LAUNCH.md §3 监控阈值在 Sentry / Grafana 配好告警
- [ ] 备份 SQL 测试还原一次（验证 backups 真能用）

### D-Day（小时级）

- [ ] 09:00 Bangkok：rolloutBps=500（5%）+ city=Bangkok
- [ ] 12:00 / 15:00 / 18:00：看 4 项核心指标
- [ ] 22:00 决策：通过/暂停/回滚

### Post（D+1 起）

- [ ] 每天看 admin.loverush.com 总览
- [ ] 每天看未处置风控事件
- [ ] 邀请码消耗速度 → 决定是否补发 A 类官方码
- [ ] 跑 e2e 回归测试一次（dev 环境）

---

## 9. 部署版本管理

部署新版（Vultr API）：
```bash
ssh loverush@<vultr_ip>
cd /opt/loverush
git pull
cd code && pnpm install --frozen-lockfile=false

# 滚动重启
sudo systemctl restart loverush-api
sudo journalctl -u loverush-api -f --since="1 minute ago"
```

如果 schema 有变更：
```bash
DATABASE_URL=$DB_URL pnpm --filter @loverush/db generate
# 检查 migrations/0XXX_*.sql + 配对 down.sql
DATABASE_URL=$DB_URL pnpm --filter @loverush/db migrate
sudo systemctl restart loverush-api
```

回滚：见 `LAUNCH.md §4 回滚预案` + `packages/db/migrations/README.md §5`。

---

## 10. 故障排查

| 症状 | 排查命令 |
|------|---------|
| API 502 | `sudo systemctl status loverush-api` + `journalctl -u loverush-api -n 100` |
| 数据库连接慢 | `psql $DATABASE_URL -c "SELECT version();"` |
| Stripe webhook 收不到 | Stripe Dashboard → Webhooks → 看 attempts；nginx 日志看 /webhooks/stripe 是否进来 |
| R2 上传 403 | R2 CORS 规则 + bucket public access + API token 权限 |
| Sentry 没数据 | Sentry → Issues → 看 Inbound Filters；4xx 不上报是预期 |

---

## 11. 凭证轮换提醒

参考 `LAUNCH.md §6`：JWT 90d / VAPID 365d / R2 180d / LLM 180d。
设个日历提醒，不要忘。
