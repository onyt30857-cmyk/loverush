# Cloudflare Pages 部署 · web / admin

LoveRush web（H5）和 admin（后台）都可以部署到 Cloudflare Pages。
本文是配置清单。

## 1. Pages Project 创建

Dashboard → Workers & Pages → Create application → Pages → Connect to Git。

| Project | Production branch | Build command | Build output | Root directory |
|---------|------------------|---------------|---------------|----------------|
| `loverush-web`   | `main` | `pnpm install --frozen-lockfile=false && pnpm --filter @loverush/web build` | `apps/web/.next` | `/` |
| `loverush-admin` | `main` | `pnpm install --frozen-lockfile=false && pnpm --filter @loverush/admin build` | `apps/admin/.next` | `/` |

## 2. Environment Variables

### loverush-web（Production）

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://api.loverush.com` |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://xxx@xxx.ingest.sentry.io/xxx` |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `<vapid public key · 与 API 的 VAPID_PUBLIC_KEY 配对>` |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | `https://media.loverush.com` |
| `NODE_VERSION` | `20` |

### loverush-admin（Production）

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://api.loverush.com` |
| `NEXT_PUBLIC_SENTRY_DSN` | （可选 · 与 web 不同 project） |
| `NODE_VERSION` | `20` |

## 3. Custom Domains

Pages → Custom domains → Set up custom domain。

| Project | Domain |
|---------|--------|
| `loverush-web`   | `loverush.com`、`www.loverush.com` |
| `loverush-admin` | `admin.loverush.com`（建议加 Cloudflare Access 限制访问） |

## 4. Next.js on Cloudflare Pages 注意

Next.js 15 + Cloudflare Pages 默认走 `@cloudflare/next-on-pages` 适配器。
如果项目里没装这个适配器，可以走两种路径：

**路径 A**：装适配器（推荐 · 完整 SSR 在 CF Workers）
```bash
pnpm --filter @loverush/web add -D @cloudflare/next-on-pages
# package.json scripts:
#   "build:cf": "next-on-pages"
# Pages 构建命令改成：pnpm --filter @loverush/web build:cf
# Build output 改成：apps/web/.vercel/output/static
```

**路径 B**：纯静态导出（仅适合纯 H5，无 SSR）
```js
// next.config.mjs
const nextConfig = { output: 'export' };
```
注意：登录态 / SSR 路由会失效，需要前端全部走 fetch。

> 当前 web 主要是客户端组件（'use client'），所以路径 A 或 路径 B 都可。如果遇到 SSR 兼容问题 → 走 B 改纯 SPA + 客户端 fetch。

## 5. Cloudflare Access（admin 加强）

Pages → loverush-admin → Settings → Access policies：

- Action: Allow
- Include: Emails ending in `@loverush.com`（或具体邮箱列表）
- Require: One of the configured IdPs（Google / GitHub）

设置后访问 admin.loverush.com 会先弹 Cloudflare Access 登录页，过了才能到 admin 应用。
即使有人拿到了 admin 助记词，也得先过 Access 这层。

## 6. 备用：API 部署到 Cloudflare Workers？

LoveRush API 当前栈是 **Hono + Bun + drizzle-orm/postgres-js**，
`drizzle-orm/postgres-js` 在 Workers 不能直接用（需要 Hyperdrive）。

短期推荐：API 跑 **Bun on Vultr**（见 `infra/systemd/loverush-api.service`），  
长期可升级：API 走 Workers + Hyperdrive + Drizzle Workers driver，配置复杂度高。
