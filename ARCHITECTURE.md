# ARCHITECTURE.md · LoveRush 代码架构

> 新人 onboarding 入口。读完这一份能理解：项目长什么样、为什么这样设计、改东西从哪下手。
>
> 业务 PRD → 上级目录 `../PRD-为爱冲锋-v1.0.md`
> 部署 → `DEPLOY.md` · 上线运行 → `LAUNCH.md` · 技术债 → `../v1/TECH-DEBT.md`

---

## 1. 30 秒看懂

```
   客户端                                       平台                                    
   ┌────────────┐                       ┌──────────────────┐                          
   │ Customer   │ ─ H5 (Next.js) ────┐  │  Hono API + Bun  │                          
   └────────────┘                    ├─▶│  ┌────────────┐  │ ─── pgvector ──▶ Postgres
   ┌────────────┐                    │  │  │ 15 service │  │                          
   │ Therapist  │ ─ H5 (Next.js) ────┤  │  │ 14 route   │  │ ─── 64 tables ─▶ Supabase
   └────────────┘                    │  │  └────────────┘  │                          
   ┌────────────┐                    │  └──────────────────┘                          
   │ Admin      │ ─ Next.js 桌面 ────┘                                                  
   └────────────┘                          ↑                                          
                                       ┌──┴──┐                                        
                                       │ LLM │ Claude 主 / OpenAI / Gemini 备           
                                       └─────┘                                        
```

业务模块 15 个（M01-M15），数据库 64 张表，API 140 个端点，27000+ 行 TypeScript。
端到端可跑闭环：注册（BIP-39）→ 浏览 → 派单 → 锁价 → 支付 → 服务 → 评价 → 凭证链。

---

## 2. Monorepo 结构

```
code/
├── apps/
│   ├── api/         # Hono · Bun · 业务后端
│   │   └── src/
│   │       ├── index.ts           # 入口 · Hono app + middleware 装配
│   │       ├── env.ts             # 环境变量 zod 校验（无凭证全自动 stub）
│   │       ├── db.ts              # createDb 单例
│   │       ├── middleware/        # auth / role / errors / i18n / tracing / idempotency / rate-limit
│   │       ├── services/          # 业务逻辑 · 25 个
│   │       └── routes/            # HTTP 端点 · 18 个
│   ├── web/         # Next.js 15 · 客户/技师双端共用 H5（390px 固定宽）
│   │   └── app/
│   │       ├── (客户端)            # /discover、/conversations、/me、/assistant
│   │       └── t/                 # 技师端 /t/home、/t/pending、/t/me
│   └── admin/       # Next.js 15 · 桌面布局 · 9 页（dashboard/users/audit/...）
├── packages/
│   ├── db/          # Drizzle ORM schema + migrations + rollback CLI
│   ├── types/       # 共享类型（ApiResponse / ErrorCode / Order / Points 等）
│   ├── llm/         # LLM 网关（多 provider 容错 · T1/T2/T3 路由）
│   ├── i18n/        # 6 语种文案（zh/en/th 实装，vi/ms/id 占位）
│   ├── ui/          # 共享 React 组件（cn helper · 待扩 P2）
│   └── utils/       # 通用工具
└── infra/
    ├── systemd/     # Bun on Vultr unit files
    ├── nginx/       # 反向代理配置
    ├── cloudflare/  # Pages + wrangler.toml + R2 配置
    ├── docker/      # docker-compose.dev / .full
    └── github-actions/  # CI workflow
```

---

## 3. 数据库分层（64 张表 · 按业务）

| 层 | 表 | 关键表 |
|----|------|--------|
| **身份** | 6 | users / sessions / device_fingerprints / invite_codes / encryption_keys / user_roles |
| **关系** | 3 | invite_relationships / r_code_levels / r_code_milestones |
| **技师业务** | 5 | therapists / media_assets / content_audit_records / customer_relationship_profile / block_list |
| **客户偏好** | 5 | customer_preferences / customer_master_preferences / customer_assistant_profile / customer_session_preferences / customer_behavior_profile |
| **订单链** | 3 | orders / order_chain / dispatch_offers |
| **私聊** | 5 | conversations / messages / message_translations / translation_cache / glossary_entries |
| **商业** | 7 | points_account / points_transaction / shop_items / therapist_shop_listings / shop_orders / tips / therapist_earnings + withdrawals |
| **评价** | 2 | reviews / reputation_scores |
| **风控审核** | 5 | risk_events / ip_blacklist / price_lock_audits / content_audit_records（共享）/ pin_attempts |
| **AI 分身日志** | 3 | ai_alter_messages / ai_alter_redline_logs / simhash_index |
| **客服** | 3 | tickets / ticket_messages / penalty_rules |
| **通知** | 3 | notifications / user_push_preferences / web_push_subscriptions |
| **隐私** | 1 | privacy_settings |
| **运营** | 3 | feature_flags / feature_flag_user_overrides / analytics_events + daily_agg |

每张表都在 `packages/db/src/schema/*.ts`，类型由 drizzle 推断 + 共享到 types 包。

---

## 4. 服务分层（25 个）

按调用方向画图（高层 → 低层）：

```
Routes (HTTP) ──▶ Services (Business) ──▶ DB / LLM Gateway / R2 / Stripe
                       │
                       ├─ chain.ts      凭证链 hash 计算
                       ├─ points.ts     积分原子操作（credit/debit/transfer）
                       └─ stripe / r2 / sentry / web-push  外部集成
```

| 服务 | 职责 |
|------|------|
| `auth.ts` | BIP-39 注册 / 助记词找回 / JWT 签发 / sessions 管理 |
| `roles.ts` | grant / revoke / hasAnyRole（D-103 用） |
| `orders.ts` | 11 状态机 · 转移 + 链事件 append + 价格锁 |
| `chain.ts` | sha256 哈希链 · 工具函数（appendChainEvent / verifyChain） |
| `therapists.ts` | profile upsert + 字段差异化（self/admin/paid/free） + 完整度计算 |
| `media.ts` + `r2.ts` | 上传 URL 签发（真 R2 或 stub） + finalize 入审核 |
| `moderation.ts` | 审核队列 + 通过/拒绝 + 副作用同步 |
| `risk.ts` | 风控事件 + IP 黑名单 + 30 单价格守门 + 设备多账户 |
| `dispatch.ts` | 即时派单广播 + 乐观锁抢占 accept |
| `recommend.ts` | 召回 + 多因子评分 + 关系档位调权 |
| `assistant.ts` | LLM 客户助理 greet/chat/偏好抽取（v5 ZERO 标识） |
| `behavior.ts` | 客户 mode 计算（steady/explorer/mixed） |
| `blockings.ts` | 双向封锁查询 |
| `chat.ts` | 会话 + 消息发送 + 异步翻译 + AI 分身钩子 + e2e 跳过 |
| `translate.ts` | LLM 翻译 + 缓存命中 + 文化注解 |
| `simhash.ts` | 64-bit FNV + 汉明距离反重复 |
| `redline.ts` | 5 类红线规则 + LLM 语义判断 + rewrite/block |
| `ai_alter.ts` | AI 分身主流程：DNA prompt → 候选 → simhash → redline → 发消息 |
| `points.ts` | 积分原子操作（credit/debit/transfer · 行锁 + idempotency） |
| `payments.ts` | 充值 channel switch（stub / stripe / adyen） |
| `stripe.ts` | Payment Intent + Webhook 签名校验 + 事件处理 |
| `paywall.ts` | 付费墙解锁（社交联系/付费相册） |
| `shop.ts` | 橱窗 CRUD + 下单 + 分成（积分 + USD cents 双口径） |
| `tips.ts` | 小费 12% 平台抽成 |
| `withdrawals.ts` | 申请/批准/拒绝 + earnings 冻结流转 |
| `reviews.ts` | 三维评分 + 滑窗均值 + 申诉裁决 |
| `analytics.ts` | 埋点 track + 日聚合 |
| `dashboard.ts` | 三视图聚合 SQL |
| `flags.ts` | sha256 分桶 + targeting + override 评估 |
| `invites.ts` | 5 类邀请码生成 + 关系链 + R 码阶梯分成 |
| `tickets.ts` | 工单状态机 + AI 异步分类 + 仲裁四动作 |
| `notifications.ts` | enqueue + 偏好/静默时段决策 + Web Push fanout |
| `web-push.ts` | VAPID + 失败处置（410 禁用 / 累计失败禁用） |
| `privacy.ts` | PBKDF2 PIN + 指数退避锁定 |
| `sentry.ts` | 错误监控懒加载 + 4xx 不上报 |

---

## 5. 关键设计决策（记下来给后人）

按时间顺序的 14 个 phase 演进出来的决策。每条都有"为什么"，违反前必须先理解。

### 5.1 v5 政策：客户端 ZERO AI 标识

**决策**：H5 客户端任何位置不出现 "AI / 助理 / bot / 自动" 等字样。

**理由**：用户调研（5 次需求迭代）后发现，早期项目阶段，AI 标识会让用户产生"机器人"距离感。客户端体感上 AI 分身就是技师本人，AI 助理就是"贴心私人助理"。

**约束**：
- `services/assistant.ts` 和 `services/ai_alter.ts` 的 system prompt 明确禁止自称"AI / 助理"
- 工单 AI 一线分类在服务端用，客户端只显示"客服小助手"
- redline 5 红线之一是 "fake_memory" 防止 AI 编造记忆

**例外**：服务端日志、Sentry、admin 后台可保留 AI 标识。

### 5.2 价格守门 vs 反加钟话术

**决策**：保留**价格锁机制**（订单进入 LOCKED 状态后服务端 sha256 锁价），删除**NLP 反加钟话术检测**。

**理由**：用户多次表态"客户在乎的不是话术，是技师是不是满意"。NLP 误判风险 + 客服 false positive 成本 > 收益。

**保留**：M11 价格守门做 30 单偏差检测（统计偏离阈值告警），不做对话内容 NLP 扫描。

### 5.3 端到端加密（Phase 13 / D-204）

**决策**：客户端 BIP-39 → HKDF → X25519 + ephemeral key 前向保密 + AES-GCM。

**权衡**：
- ✓ 私钥永不上服务端（`encryptedPrivateKey` 字段填 `'CLIENT_HELD'` sentinel）
- ✓ 前向保密（PFS）：每条消息独立 ephemeral key
- ✗ 加密消息无法翻译 / 无法 AI 分身回复 / 无法服务端红线
- → 设计为**可选 toggle**，默认走平台中转，用户主动开启 e2e

### 5.4 H5 vs Native

**决策**：纯 H5 + PWA + Telegram Mini App，不做原生 App。

**理由**：避开 Apple/Google 商店审核 + 一套代码多端跑 + 上架成本低。

**约束链**：
- 应用图标/名称动态切换功能撤销（M15 §F15.6 已撤）
- 截屏防护降级为 CSS+JS 三层兜底（T-105）
- 原生 push 不做，只有 Web Push + Telegram Bot push（M13）

### 5.5 LLM 多 provider 容错

**决策**：Anthropic 主、OpenAI / Gemini 备，按 T1/T2/T3 三档路由 + 429/超时自动降级。

**实现**：`packages/llm/src/gateway.ts` 的 `complete()` 函数遍历 provider 链，碰到 retryable error（429 / 5xx / TIMEOUT）切下一个，不可重试错误（401 / 400）直接抛。

**好处**：单一 provider 挂掉不会全站瘫痪；不同 tier 用不同模型省成本（Haiku for 简单任务 / Opus for 复杂推理）。

### 5.6 凭证链（M07）

**决策**：每个订单有一条 `order_chain` 哈希链，sha256(prev_hash + canonical(payload) + seq + event_type)，append-only。

**为什么**：撮合平台不做支付结算 → 出问题时需要"非赖账"证据。哈希链可被任何第三方验证，提高仲裁可信度。

**实现**：`services/chain.ts` 的 `appendChainEvent` + `verifyChain`；订单详情页（客户和技师都）有 `/order/[id]/chain` 入口可查验。

### 5.7 角色矩阵（D-103）

**决策**：`user_roles` 表 + 5 种角色（admin / auditor / finance / cs / ops）+ `requireRole(['admin', 'cs'])` 中间件。

**实现**：每个 admin 路由按业务挂对应角色：审核 → admin+auditor，工单 → admin+cs，提现 → admin+finance，灰度 → admin+ops。

**第一个 admin** 必须通过 SQL 直接 INSERT（避免循环依赖：admin 路由需要 admin 角色，第一个 admin 没有 admin 角色赋权人）。

### 5.8 Stripe Stub Fallback

**决策**：`STRIPE_SECRET_KEY` 未配时，`channel='stripe'` 自动降级为直接 credit 积分（stub）。

**为什么**：本地开发 + CI 不依赖 Stripe sandbox 也能跑全套 e2e。生产填上 key 自动切真路径。

**同样的模式**：R2 / VAPID / Sentry 全部"留空 noop"，让无凭证开发也能跑通核心流程。

---

## 6. Phase 演进历史

| Phase | 主题 | 关键产出 |
|-------|------|---------|
| **1** | 地基 | monorepo + 16 表 schema + LLM 网关 + 中间件 + M01 注册 |
| **2** | 技师供给 | M02 信息维护 + M07 订单状态机 + M11 风控基础 |
| **3** | 双端核心 | M03 客户助理 + M04 派单 + M05 私聊 |
| **4** | AI + 商业 | M06 AI 分身 + M09 商业 + M08 评价 + M14 埋点 |
| **5** | 增长 + 完善 | M10 邀请码 + M12 客服 + M13 通知 + M15 隐私 |
| **6** | 灰度 + i18n | Feature Flag + M14 看板 + 三语种文案 + Web Push + 上线 SOP |
| **7** | H5 前端 | 客户/技师 16 页 + PWA + Service Worker |
| **8** | 联调收尾 | E2E 测试 + Docker Compose + TECH-DEBT 扫描 |
| **9** | P0 Gate · 1 | admin 角色 + Stripe + /me + CI |
| **10** | P0 Gate · 2 | R2 上传 + e2e 9.x + 迁移 rollback |
| **11** | 监控 + 后台 | Sentry + Admin UI 8 页 |
| **12** | 部署 | systemd + nginx + CF Pages + DEPLOY.md |
| **13** | 最后 P1 | 端到端加密（BIP-39 → X25519 + AES-GCM） |
| **14** | 扫尾 + 演练 | viewerHasPaid + e2e 13.x + D-Day 演练脚本 |

---

## 7. 改东西从哪下手？

| 想做的事 | 入口 |
|----------|------|
| 新增 schema 表 | `packages/db/src/schema/` 加文件 → `index.ts` export → `generate` |
| 新增 API 端点 | `apps/api/src/services/<biz>.ts` 写业务 → `routes/<biz>.ts` 暴露 → `index.ts` mount |
| 修 system prompt | `services/assistant.ts` 或 `services/ai_alter.ts`，注意 v5 ZERO AI 政策 |
| 加 admin 后台页 | `apps/admin/app/<page>/page.tsx` + 在 `AdminShell.tsx` 加 NAV |
| 加 H5 客户端页 | `apps/web/app/<page>/page.tsx` + 在 `AppShell.tsx` 加 tab |
| 加 LLM 提供商 | `packages/llm/src/providers/<provider>.ts` 实现 `LLMProvider` 接口 |
| 加错误码 | `packages/types/src/errors.ts` 加常量 + `packages/i18n/src/locales/*.json` 加文案 |
| 加 e2e 测试 | `apps/api/test/e2e-*.test.ts` 新文件 · 复用 `helpers.ts` |
| 加 feature flag | `POST /admin/flags/<key>` · 业务点 `isEnabled` 调用 |

---

## 8. 常见陷阱

1. **路由注册顺序**：`/me` 必须在所有 `/me/*` 之后注册（Hono 短路径会抢匹配）
2. **chat 异步钩子循环**：客户发消息 → AI 分身回复 → 不再触发 AI（看 `args.isAiAlter` 标记）
3. **加密消息跳过翻译**：`services/chat.ts` 里 `if (!args.isEncrypted)` 才走翻译
4. **生产数据库迁移**：必须配对 `*.down.sql`（见 `packages/db/migrations/README.md`）
5. **stripe webhook raw body**：nginx `proxy_request_buffering off`，不能让中间层 parse JSON
6. **Cloudflare Workers 不兼容**：drizzle-orm/postgres-js + Stripe SDK + web-push 都需要 Node runtime，部署路径选 Bun on Vultr 不是 Workers

---

## 9. 文档导航

| 文档 | 用途 |
|------|------|
| `README.md` | 项目概述 + Phase 进度清单 |
| `ARCHITECTURE.md` | **本文** · 代码架构 + 关键决策 |
| `DEPLOY.md` | 部署 SOP（凭证 / 数据库 / API / Web / Admin / D-Day） |
| `LAUNCH.md` | 上线运行（灰度策略 / 监控阈值 / 回滚预案 / 凭证轮换） |
| `SETUP.md` | 本地开发启动 |
| `CHANGELOG.md` | 版本变更日志 |
| `../v1/TECH-DEBT.md` | 技术债务清单（P0~P3 优先级） |
| `../v1/CLAUDE.md` | 项目背景 + 业务定位（给 AI 编程助手用） |
| `../v1/modules/M*.md` | 15 个业务模块详细需求 |
| `../PRD-为爱冲锋-v1.0.md` | 完整 PRD |
| `infra/cloudflare/pages.md` | Cloudflare Pages 部署清单 |
| `packages/db/migrations/README.md` | 迁移 / rollback 编写约定 |
