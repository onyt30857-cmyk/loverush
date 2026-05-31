# Cloudflare 橙云加速 LoveRush · 保姆级配置

**预期收益**:东南亚/中国用户首屏 TTFB **600ms → 50ms**(物理 RTT 解决)· 全球 P95 砍 80% · 月费 **0 元**(免费 plan 够用)。

**总耗时**:60-90 分钟一次性配置 + DNS 生效等待(5-30 分钟)。

---

## 前置准备

你需要 3 样东西:

| 项 | 说明 | 没有怎么办 |
|---|---|---|
| 1️⃣ 自有域名 | 例如 `loverush.com` | Cloudflare 上直接买($8/年起)· 或 Namecheap / Porkbun |
| 2️⃣ Cloudflare 账号 | https://dash.cloudflare.com/sign-up | 免费 |
| 3️⃣ Railway 项目可访问 | 你已有 | — |

**注意**:如果你打算用 Railway 默认的 `loverush-web-production.up.railway.app`,**Cloudflare 不能代理那个域**(它是 Railway 的二级域)。**必须先有自己的域名**。

---

## 阶段 1 · 把域名加入 Cloudflare(管 DNS)

> 如果你的域名已经在 Cloudflare,跳过本阶段。

### 1.1 Cloudflare 添加站点

1. 登 https://dash.cloudflare.com
2. 顶部点 `Add a Site`
3. 输入你的域名(如 `loverush.com`)→ Continue
4. 选 `Free` plan → Continue

### 1.2 Cloudflare 扫描现有 DNS 记录

CF 会自动扫一遍你域名的现有 DNS(从原 registrar)
→ 确认无误 → Continue

### 1.3 换 Nameservers(关键)

CF 会给你 **2 个 nameservers**,长这样:

```
chuck.ns.cloudflare.com
liz.ns.cloudflare.com
```

去你域名注册商(Namecheap / GoDaddy / 阿里云 / 腾讯云 / Porkbun)的 DNS 设置:
- 找 `Nameservers` / `域名服务器` / `NS 记录` 入口
- 把原有的全删掉,**填上 CF 给你的这 2 个**
- 保存

### 1.4 等 DNS 生效

回 Cloudflare,点 `Done, check nameservers`。

通常 **5-30 分钟**生效(看 registrar 速度,极端 24h)。CF 验证成功后会发邮件,域名 Overview 页会显示 `Active` 绿勾。

**这一步不做完,后面所有操作都没用** — 确认 Active 再继续。

---

## 阶段 2 · Railway 加自定义域名

### 2.1 Web 服务加 `app.loverush.com`

1. 打开 https://railway.app/dashboard
2. 进 `earnest-curiosity` 项目
3. 点 `loverush-web` 服务 → `Settings` tab
4. 找到 `Networking` 区块 → 点 `+ Custom Domain`
5. 输入 `app.loverush.com`(或 `www.loverush.com` · 看你喜好)→ Add
6. **Railway 会给你一个 CNAME target**,长这样:

```
fcyl2cjs.up.railway.app
```

📋 **复制这个 CNAME target**,后面要用。

### 2.2 API 服务加 `api.loverush.com`

1. 同上,但点 `loverush` 服务(API)→ Settings → Networking → Custom Domain
2. 输入 `api.loverush.com` → Add
3. 复制 API 服务的 CNAME target

---

## 阶段 3 · Cloudflare 加 DNS 记录(2 条)

### 3.1 Web 域名记录

1. CF Dashboard → 进你的域名 → 左侧 `DNS` → `Records`
2. 点 `Add record`
3. 配置:

| 字段 | 填什么 |
|---|---|
| Type | `CNAME` |
| Name | `app`(只填子域,不带 `.loverush.com`) |
| Target | 步骤 2.1 复制的 `fcyl2cjs.up.railway.app` |
| **Proxy status** | **🟠 Proxied(橙云)← 关键!** |
| TTL | Auto |

→ Save

### 3.2 API 域名记录

重复 3.1,但:

| 字段 | 填什么 |
|---|---|
| Name | `api` |
| Target | 步骤 2.2 复制的 API CNAME target |
| **Proxy status** | **🟠 Proxied(橙云)** |

→ Save

⚠️ **务必橙云,灰云没效果!**

---

## 阶段 4 · Cloudflare SSL 设置

1. CF → 域名 → `SSL/TLS` → `Overview`
2. `Encryption mode` 选 **Full (strict)**
3. 保存

> Railway 自带 Let's Encrypt 证书,Full(strict)能正确验证。

---

## 阶段 5 · Cloudflare Cache Rules(让静态资源边缘缓存)

这是性能提升最大的一步。

### 5.1 进入 Cache Rules

1. CF → 域名 → `Rules` → `Cache Rules`(或 `Caching → Cache Rules`)
2. 点 `Create rule`

### 5.2 规则 1 · Next.js 静态资源

| 字段 | 填什么 |
|---|---|
| Rule name | `next-static-immutable` |
| When incoming requests match... | 选 `URI Path` · `starts with` · `/_next/static/` |
| Cache eligibility | `Eligible for cache` |
| Edge TTL | `Override origin` → `1 year` |
| Browser TTL | `Override origin` → `1 year` |

→ Deploy

### 5.3 规则 2 · proto-images 静态图

重复 5.2,但:

| 字段 | 填什么 |
|---|---|
| Rule name | `proto-images-immutable` |
| URI Path `starts with` | `/proto-images/` |
| 其他 | 同上 |

→ Deploy

### 5.4 规则 3 · API 公开 GET 边缘缓存(可选,推荐)

只给**完全公开 + 数据慢变**的 GET endpoint 缓存:

| 字段 | 填什么 |
|---|---|
| Rule name | `splash-config-cache` |
| Hostname `equals` | `api.loverush.com` AND |
| URI Path `equals` | `/splash/config` |
| Cache eligibility | `Eligible for cache` |
| Edge TTL | `Respect origin TTL`(代码已发 s-maxage=300) |

→ Deploy

---

## 阶段 6 · 更新 Web 的 API 地址

让 web 调 `api.loverush.com` 而不是直连 Railway:

### 6.1 Railway 改 env

1. Railway → `loverush-web` 服务 → Variables tab
2. 找 `NEXT_PUBLIC_API_URL` → 改成 `https://api.loverush.com`
3. Save · Railway 会自动重部署 web(2-3 分钟)

### 6.2 等 web 部署完

`railway deployment list --service loverush-web` 看到 `SUCCESS`。

---

## 阶段 7 · 验证

### 7.1 命令行验证 cache HIT

```bash
# 静态资源应该 HIT
curl -I https://app.loverush.com/_next/static/chunks/main-app-xxx.js 2>&1 | grep -iE "cf-cache-status|cf-ray|server"

# 期望看到:
# cf-cache-status: HIT     ← 关键!
# server: cloudflare
# cf-ray: xxx-SIN          ← 后缀 SIN 表示新加坡 PoP
```

### 7.2 测 TTFB(从你电脑)

```bash
# 改造前(直连 Railway)
curl -o /dev/null -w "TTFB=%{time_starttransfer}s\n" https://loverush-web-production.up.railway.app/

# 改造后(走 CF)
curl -o /dev/null -w "TTFB=%{time_starttransfer}s\n" https://app.loverush.com/

# 期望 CF 路径快 200-500ms · 静态资源能差 1-2s
```

### 7.3 第三方工具验证

打开 https://www.webpagetest.org/
- 输入 `https://app.loverush.com`
- Test Location 选 **Singapore - Chrome**
- 跑一遍看 LCP、TTFB

---

## 阶段 8 · 真机测试

用手机打开 `https://app.loverush.com`:
- 第 1 次进站:首屏图秒出
- 关浏览器再开:基本秒进
- 切页面:几乎无感

---

## 常见坑 · FAQ

### Q1 · CF 把登录后页面缓存了,串号怎么办?
**默认不会** — CF 不缓存带 `Authorization` header 或 `Cookie` 的请求。但保险起见:
- 给 `/me` `/conversations` 等接口在后端**显式发 `Cache-Control: private, no-store`**(我已加 LRU,你需要时告诉我加)

### Q2 · DNS 没生效怎么办?
- 用 https://dnschecker.org 查 `app.loverush.com` 的 CNAME 在全球是否传播
- 等 30 分钟以上还不行 → 检查 registrar 那边 nameservers 真换了没

### Q3 · CF 显 521 / 522 / 525?
- 521 = origin 拒绝连接 → 检查 Railway 服务是否在线
- 522 = origin 超时 → Railway 服务可能死锁(看你最近改过什么)
- 525 = SSL 握手失败 → SSL 模式可能选错,改成 `Full`(不带 strict)试

### Q4 · Always Use HTTPS 要不要开?
**要开**。CF → SSL/TLS → Edge Certificates → `Always Use HTTPS` = ON。

### Q5 · 我能不能两个域名都不动,只走 CF 的 Workers Routes 代理?
能,但配置复杂(要写 Worker 代码)。**这套 CNAME + 橙云方案最简单,推荐**。

---

## 上线后的回归测试 Checklist

- [ ] `https://app.loverush.com/` 能正常打开 splash 4 屏
- [ ] 登录后能正常显 `/home` + 技师列表
- [ ] 聊天 / SSE 实时推送正常(WebSocket / SSE 走 CF 默认 OK)
- [ ] 头像上传走 R2(CF 不缓存上传请求,默认 OK)
- [ ] 私聊气泡显头像 + 昵称
- [ ] H5 PWA `manifest.json` 仍可访问

---

## 配置完告诉我

跑完 `curl -I https://app.loverush.com/_next/static/...` 看到 `cf-cache-status: HIT` 截图发我,我帮你看下还有什么能继续优化。

如果遇到任何卡住,把出错的截图发我(包括 Cloudflare 的报错页 / Railway 的 deploy log / 浏览器 console),我帮你诊断。
