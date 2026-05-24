# LoveRush · 代码工程

> 为爱冲锋 v1 · 单 monorepo · TypeScript 全栈
>
> 业务文档：见上级目录的 `PRD-为爱冲锋-v1.0.md` 和 `v1/`

---

## 快速开始

```bash
# 1. 安装依赖（需要 Node 20+ 和 pnpm 9+）
pnpm install

# 2. 复制环境变量
cp .env.example .env.local
# 填入真实值（数据库 / LLM key / 支付 key 等）

# 3. 数据库迁移
pnpm --filter @loverush/db push

# 4. 启动开发
pnpm dev           # 全部启动
pnpm --filter @loverush/api dev    # 仅启动后端
pnpm --filter @loverush/web dev    # 仅启动客户端
```

访问：
- 客户端 H5：http://localhost:3000
- 平台管理：http://localhost:3001
- 后端 API：http://localhost:8787

---

## 目录结构

```
code/
├── apps/
│   ├── web/        # 客户端 H5（Next.js 15）
│   ├── api/        # 后端 API（Hono · Bun/Cloudflare Workers）
│   └── admin/      # 平台管理后台（Next.js 15）
├── packages/
│   ├── db/         # Drizzle schema + migrations
│   ├── types/      # 共享 TypeScript 类型 + Zod schema + 错误码
│   ├── llm/        # LLM 网关（多 Provider 容错）
│   ├── i18n/       # 6 语种文案管理
│   ├── ui/         # 共享 React 组件
│   └── utils/      # 通用工具函数
├── infra/
│   ├── cloudflare/         # Workers / Pages 配置
│   ├── docker/             # Vultr Docker compose
│   └── github-actions/     # CI/CD 配置
└── docs/           # 工程文档
```

---

## 技术栈

详见 [`../v1/decisions/ADR-001-tech-stack.md`](../v1/decisions/ADR-001-tech-stack.md)

```
后端：Hono + TypeScript + Drizzle + PostgreSQL（Supabase）+ Upstash Redis
前端：Next.js 15 + React 19 + Tailwind + shadcn/ui
AI：Claude 主 + OpenAI 备 + Gemini 备
部署：Cloudflare Pages + Workers / Bun on Vultr
Monorepo：pnpm + Turborepo
```

---

## 开发命令

```bash
# 全 monorepo
pnpm build              # 构建全部
pnpm dev                # 启动全部 dev
pnpm lint               # lint 全部
pnpm test               # 测试全部
pnpm typecheck          # 类型检查全部
pnpm format             # Prettier 格式化

# 单 package
pnpm --filter @loverush/api <cmd>
pnpm --filter @loverush/web <cmd>
pnpm --filter @loverush/db <cmd>

# 数据库
pnpm --filter @loverush/db generate    # 生成迁移
pnpm --filter @loverush/db migrate     # 应用迁移
pnpm --filter @loverush/db studio      # Drizzle Studio
```

---

## 开发约定

### Git 流程
- main 分支：保护 · 仅 PR merge
- 功能分支：`feat/M0X-xxx` / `fix/M0X-xxx` / `chore/xxx`
- Commit 规范：Conventional Commits（feat / fix / chore / docs / refactor）

### 代码风格
- TypeScript strict mode
- ESLint + Prettier 自动格式化
- pre-commit hook：lint-staged + typecheck

### 模块边界
- 跨模块通过 `@loverush/types` 共享类型
- 业务逻辑：apps/api/src/services/
- 数据访问：apps/api/src/repositories/（仅在 db 包外通过 repo 访问）

---

## Phase 1 进度

详见 [`../v1/STARTUP-GUIDE.md`](../v1/STARTUP-GUIDE.md)

- [x] 1.1 Monorepo 初始化
- [x] 1.2 数据库 schema（16 表 · enums + users/sessions/auth/preferences/assistant/therapists/points/orders/relationship）
- [x] 1.3 LLM 网关（Claude/OpenAI/Gemini · T1/T2/T3 路由 + 429/超时降级）
- [x] 1.4 API 中间件（错误码/idempotency/限流/i18n/tracing）
- [x] 1.5 M01 注册（双端）— BIP-39 24 词 + H5 注册/备份/找回三页
- [x] 1.6 基础设施配置（drizzle 生成迁移 + seed + Sentry 等）

## Phase 2 进度

- [x] 2.1 Schema 第二批（therapists 扩展 + media + moderation + risk · 4 张新表）
- [x] 2.2 M07 订单状态机服务（11 状态机 + 17 事件 + sha256 哈希链 + 价格锁）
- [x] 2.3 M02 技师信息 API（CRUD + 字段差异化 + 媒体上传 init/finalize + 完整度计算）
- [x] 2.4 M11 入驻审核 + 风控基础（审核工单 + 风控事件 + IP 黑名单 + 30 单价格守门）
- [x] 2.5 模块文档同步（M07 alias / M11 删 F11.3 / M02 录屏永久保留）

## Phase 3 进度

- [x] 3.1 Schema 第三批（dispatch_offers + conversations/messages/translations/cache/glossary + block_list · 7 张新表）
- [x] 3.2 M03 客户 AI 助理（greet/chat/inferPreferences + 精准推荐 + 一键封锁 + 动态行为 mode）
- [x] 3.3 M04 匹配与分发（即时派单广播 + 首接锁定 + 拒绝/过期）
- [x] 3.4 M05 私聊核心（REST 消息 + 6 语种翻译 + 文化注解 + 翻译缓存 + 平台中转）
- [x] 3.5 模块文档同步（M03 撤危机/心理、M04 撤 shows、M05 WS 延期）

## Phase 4 进度

- [x] 4.1 Schema 第四批（shop_items / shop_listings / shop_orders / tips / earnings / withdrawals / reviews / reputation_scores / analytics_events / analytics_daily_agg / ai_alter_messages / ai_alter_redline_logs / simhash_index · 13 张新表）
- [x] 4.2 M06 v2 AI 分身（话术 DNA + 5 红线 + SimHash 反重复 + chat 钩子）
- [x] 4.3 M09 商业模式（积分原子操作 + 充值 stub + 付费墙 + 橱窗 + 小费 + 提现）
- [x] 4.4 M08 评价 + M14 埋点（三维评分 + 滑窗聚合 + 申诉裁决 + 埋点 + 日聚合）
- [x] 4.5 模块文档同步（M06/M08/M09/M14 v2 范围修订）

## Phase 5 进度

- [x] 5.1 Schema 第五批（invite_relationships / r_code_levels / r_code_milestones / tickets / ticket_messages / penalty_rules / notifications / user_push_preferences / web_push_subscriptions / privacy_settings / pin_attempts · 11 张新表）
- [x] 5.2 M10 邀请码体系（5 类码 + 两级关系 + R 码阶梯 3-10% + 注册联动）
- [x] 5.3 M12 客服仲裁（工单状态机 + AI 分类 + 沟通 + 仲裁四动作）
- [x] 5.4 M13 消息通知（enqueue/fanout + 推送偏好 + 静默时段 + Web Push 订阅 stub）
- [x] 5.5 M15 隐私模式 H5 适配（PIN PBKDF2 + 防爆破 + 模糊化 + 伪装类型；撤应用图标切换）
- [x] 5.6 模块文档同步（M10/M12/M13/M15 标 v1 实际范围 + H5 限制）

## Phase 6 进度

- [x] 6.1 Feature Flag 系统（feature_flags + overrides + sha256 分桶 + 灰度评估）
- [x] 6.2 M14 看板完整版（技师 / 客户 / 运营三视图聚合 API）
- [x] 6.3 i18n 文案库（zh / en / th 三语种 + t() 函数 + interpolation + fallback）
- [x] 6.4 Web Push 真实接入（VAPID + web-push 包，无凭证自动 stub）
- [x] 6.5 上线 SOP（`LAUNCH.md`：凭证清单 + 灰度策略 + 监控阈值 + 回滚预案 + D-Day 流程）

## Phase 7 进度（H5 前端）

- [x] 7.1 基础设施（API client + AuthProvider + AppShell / TherapistShell + UI primitives）
- [x] 7.2 客户端浏览+下单（/discover + /therapist/[id] + 下单 + /order/[id] + /chain）
- [x] 7.3 客户端私聊+助理（/conversations + /conversations/[id] + /assistant 三页）
- [x] 7.4 客户端我的（/me + notifications + preferences + privacy + invites 四子页）
- [x] 7.5 技师端核心（/t/home + /t/pending + /t/orders 列表+详情 + /t/messages）
- [x] 7.6 技师端编辑（/t/me + profile + ai-alter + earnings）
- [x] 7.7 PWA + Service Worker（manifest + sw.js + registerSW + subscribePush hook）

## Phase 8 进度（联调收尾）

- [x] 8.1 E2E 测试套件（`apps/api/test/e2e.test.ts` · 4 个 describe 覆盖完整闭环 + 派单抢占 + 封锁 + 翻译缓存）
- [x] 8.2 Docker Compose（`infra/docker/docker-compose.dev.yml` 仅依赖 / `.full.yml` 完整 stack + 两个 Dockerfile）
- [x] 8.3 TECH-DEBT 扫描（27 处 stub/TODO 归类到 P0/P1/P2/P3 · 见 v1/TECH-DEBT.md §99）

## Phase 9 进度（P0 上线 Gate）

- [x] 9.1 D-103 admin 角色校验（`user_roles` 表 + `requireRole` 中间件 + 应用到所有 admin 路由）
- [x] 9.2 D-101 Stripe 充值（Stripe SDK + PaymentIntent + `/webhooks/stripe` 签名校验 + idempotency；无凭证降级 stub）
- [x] 9.3 /me + /me/orders（D-201 + D-202 · 替换 auth.tsx 里的 /flags 借用）
- [x] 9.4 GitHub Actions CI（lint+typecheck / e2e+postgres / next build · 三 job）

## Phase 10 进度（最后 P0 收尾 + 测试 + 迁移）

- [x] 10.1 D-102 R2 上传（`@aws-sdk/client-s3` + `getSignedUrl` · 无 R2 凭证降级 stub）
- [x] 10.2 E2E 9.x 覆盖（admin 拦截 + 自杀场景 + Stripe stub fallback + /me + R2 stub URL · 12+ case）
- [x] 10.3 迁移 rollback 框架（`*.down.sql` 配对约定 + `scripts/rollback.ts` CLI + LAUNCH §4 链入）

## Phase 11 进度（监控 + 后台运营 UI）

- [x] 11.1 Sentry 接入（API @sentry/node + Web @sentry/nextjs + global-error.tsx 兜底 · 4xx 不上报 · 无 DSN noop）
- [x] 11.2 Admin UI 核心页（apps/admin 桌面布局 · 8 页：登录 + dashboard + audit + tickets + withdrawals + risk + flags + roles）
- [x] 11.3 文档收尾（README + LAUNCH 同步）

## Phase 12 进度（运营缺口 + 部署）

- [x] 12.1 Admin 缺口收尾（`GET /admin/withdrawals` 列表 + `/admin/users` CRUD + 暂停/封禁/解封 + admin UI 加用户管理页）
- [x] 12.2 部署配置（systemd + nginx + Cloudflare Pages + R2 CORS · 主路径：Bun on Vultr + CF Pages）
- [x] 12.3 DEPLOY.md（完整部署 SOP · 11 章 · 从凭证 → 数据库 → API → Web → Admin → D-Day checklist）

## Phase 13 进度（D-204 端到端加密 · 最后 P1）

- [x] 13.1 客户端 crypto 库（`apps/web/lib/crypto.ts` · @noble/curves X25519 + AES-GCM + IndexedDB 私钥存储）
- [x] 13.2 注册/找回派生 + 聊天页 E2E toggle（每条消息 ephemeral key + PFS 前向保密）
- [x] 13.3 后端 POST `/me/encryption-key` + GET `/users/:id/encryption-key`；e2e 消息跳过翻译/AI 分身

## Phase 14 进度（扫尾 + 演练）

- [x] 14.1 D-203 viewerHasPaid 真接入（`routes/therapists.ts` 查 paywall.listUnlocked）
- [x] 14.2 E2E 13.x 覆盖（公钥上传/查询/覆盖 + 加密消息流转 + 翻译跳过 + viewerHasPaid · 14+ case）
- [x] 14.3 D-Day 演练脚本（`scripts/dry-run-launch.sh` · 8 步 · 完整闭环 + 凭证链验证 + 大盘读数）

## Phase 15 进度（团队 onboarding）

- [x] 15.1 ARCHITECTURE.md（代码架构 + 模块依赖 + 关键决策 + 14 phase 演进 + 改东西从哪下手）
- [x] 15.2 GitHub repo 实例化（PR template + 4 个 issue template + CONTRIBUTING + SECURITY + LICENSE）
- [x] 15.3 CHANGELOG.md（v0.0.1 → v0.14.0 完整变更日志 · Keep a Changelog 风格）

## Phase 16 进度（视觉打磨）

- [x] 16.1 设计 token 升级（暖粉阴影 / 渐变 / 字体类 / animation keyframes · 对齐 prototype）
- [x] 16.2 UI 组件扩充（Card / Badge / OnlineDot / RecCard / GradientOrb / TypingDots · 9 个新组件）
- [x] 16.3 discover 页打磨（在线状态环 + 评分 ★ + 城市标签 + fade-up 动画）
- [x] 16.4 therapist/[id] 页打磨（大头像 hero + 三维评分卡 + 价格卡 + 渐变 CTA · gradient-soft 背景）
- [x] 16.5 assistant 页打磨（welcome hero + 4 个建议 chip + typing dots + 横滑推荐卡 · 严守 v5 无 AI 字样）

## Phase 17 进度（视觉打磨 · 续）

- [x] 17.1 私聊打磨（会话列表相对时间 + chat 页 gradient-soft 背景 + msg-bubble 复用 + 圆形发送按钮）
- [x] 17.2 订单 order/[id] 打磨（大状态卡 + Playfair 数字 + 星级动效 + 凭证链精修入口）
- [x] 17.3 我的 me 打磨（用户 hero + 渐变积分大卡 + 三栏 stat 中英对照 + 圆角图标）
- [x] 17.4 技师端打磨（t/home KPI 4 栏 + t/pending 倒计时进度条 + 紧急脉冲动画）

## Phase 18 进度（视觉打磨 · 收尾）

- [x] 18.1 入口 + 注册流程（landing blob 装饰 + register 双卡角色选择 + backup 编号 + recover 字数进度）
- [x] 18.2 客户端 me 子页（preferences emoji chip + invites R 码大卡 + 进度条 + privacy hero + 暖色 toggle）
- [x] 18.3 技师端 me 子页（t/me 完整度进度条 + ai-alter GradientOrb + earnings Playfair 数字 + 收入来源 emoji）

## Phase 19 进度（单元测试 + API 文档）

- [x] 19.1 单元测试（`unit-chain.test.ts` 11 case + `unit-simhash.test.ts` 8 case + `unit-redline.test.ts` 11 case · 共 30+ case 纯函数）
- [x] 19.2 `API.md`（~140 端点 / 16 业务分组 / 角色矩阵 / 错误码体系）
- [x] 19.3 CHANGELOG 续（v0.15.0 → v0.19.0 共 5 个版本变更日志）

## Phase 20 进度（工程加固）

- [x] 20.1 i18n 三语种补齐（vi/ms/id 共 ~100 个 key · 现已支持 6 语种全覆盖）
- [x] 20.2 `OPERATIONS.md`（13 章运维 SOP · 每日 SQL 查询模板 + 故障排查命令 + 对账规则）
- [x] 20.3 `/metrics` 端点（Prometheus 兼容 · 9 个核心业务 gauge · DAU + GMV + 队列长度）

> **🎉 Phase 1-20 全部完成 · 工程级 production-ready · 文档 11 个 · 测试 70+ case · i18n 6 语种全覆盖**
>
> **文档地图**：
> - 新人 onboarding：`ARCHITECTURE.md`
> - 贡献流程：`CONTRIBUTING.md`
> - 安全报告：`SECURITY.md`
> - 部署：`DEPLOY.md`
> - 上线后运行：`LAUNCH.md`
> - API 端点清单：`API.md`
> - 运维 SOP：`OPERATIONS.md`
> - 演练：`bash scripts/dry-run-launch.sh`
> - 版本日志：`CHANGELOG.md`
>
> 启动前最后两件：
> 1. 创建 admin user：`INSERT INTO user_roles (user_id, role) VALUES ('<uuid>', 'admin');`
> 2. 配 Stripe webhook：Dashboard endpoint `https://api.loverush.com/webhooks/stripe`

## 运行 E2E 测试

```bash
# 1. 起依赖
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 2. 推 schema
DATABASE_URL=postgres://loverush:loverush_dev@localhost:54322/loverush \
  pnpm --filter @loverush/db push

# 3. 跑 e2e
DATABASE_URL=postgres://loverush:loverush_dev@localhost:54322/loverush \
JWT_SECRET=$(openssl rand -hex 32) \
  pnpm --filter @loverush/api test

# 关停
docker compose -f infra/docker/docker-compose.dev.yml down
```

## 本地启动

```bash
# 0. 准备环境变量
cp .env.example .env.local
# 至少填：DATABASE_URL / JWT_SECRET（32+ 字符）/ ANTHROPIC_API_KEY

# 1. 安装
pnpm install

# 2. 生成迁移并推送到 DB
pnpm --filter @loverush/db generate
pnpm --filter @loverush/db push

# 3. 种子（首批邀请码）
pnpm --filter @loverush/db seed

# 4. 启动 API + Web
pnpm dev
# API → http://localhost:8787  /ping 健康检查
# Web → http://localhost:3000  注册/备份/找回三页可点
```
