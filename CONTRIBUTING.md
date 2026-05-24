# CONTRIBUTING.md

新人请先读 `ARCHITECTURE.md` 了解项目长什么样、为什么这样设计。本文是协作流程。

## 1. 准备开发环境

```bash
# 安装
git clone <repo>
cd code
pnpm install

# 起依赖容器
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 准备环境变量
cp .env.example .env.local
# 至少填：DATABASE_URL（postgres://loverush:loverush_dev@localhost:54322/loverush）+ JWT_SECRET（32+ 字符）

# 推 schema + 种子
DATABASE_URL=postgres://loverush:loverush_dev@localhost:54322/loverush \
  pnpm --filter @loverush/db push

DATABASE_URL=... pnpm --filter @loverush/db seed

# 起服务
pnpm dev
# → API: http://localhost:8787
# → Web: http://localhost:3000
# → Admin: http://localhost:3001
```

跑 E2E：
```bash
DATABASE_URL=postgres://loverush:loverush_dev@localhost:54322/loverush \
JWT_SECRET=$(openssl rand -hex 32) \
  pnpm --filter @loverush/api test
```

完整演练：`bash scripts/dry-run-launch.sh`

## 2. 分支策略

- `main`：保护分支 · 仅 PR merge · CI 必须绿
- 功能分支：`feat/M0X-xxx` / `fix/M0X-xxx` / `chore/xxx` / `debt/D-XXX`
- 一个 PR 一个功能 · 不要把 schema 改 + 业务改 + UI 改全塞一个 PR

## 3. Commit 规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | bug 修复 |
| `refactor` | 重构（行为不变） |
| `perf` | 性能优化 |
| `docs` | 仅文档 |
| `test` | 仅测试 |
| `chore` | 构建 / CI / 依赖 |
| `debt` | 技术债清理（关联 D-XXX） |

例子：
- `feat(M02): 技师档案加 service_languages 字段`
- `fix(M07): 锁价后不允许变 service_snapshot`
- `debt(D-301): 补 packages/ui Button + Modal 组件`

## 4. 改 schema 必须配 down.sql

```bash
# 1. 改 packages/db/src/schema/*.ts
# 2. 生成
pnpm --filter @loverush/db generate
# 3. 手写配对的 down.sql（约定见 packages/db/migrations/README.md）
# 4. 本地 push 验证
pnpm --filter @loverush/db push
```

CI 会阻断没有 down.sql 的 schema PR。

## 5. 加新 LLM prompt 必须自测

- 5 个典型 case 跑一遍
- 验证不违反 v5 ZERO AI 政策（客户端可见输出无 "AI/助理/bot"）
- 红线 5 类（contact / payment / fake_memory / minor / illegal）至少跑一个测试

## 6. PR 必须打勾的 Checklist

见 `.github/PULL_REQUEST_TEMPLATE.md`。简言之：
- [ ] 测试新增 / 修改
- [ ] schema 改了 → down.sql
- [ ] API 改了 → 前端同步
- [ ] LLM prompt 改了 → 测过
- [ ] 没引入新 P0 债务

## 7. Code Review 要求

- 至少 1 个 reviewer
- security / 凭证相关改动至少 2 个 reviewer（其中 1 个看安全）
- 改 `packages/db/migrations/` 必须 reviewer 确认 down.sql 可执行

## 8. 关键代码风格

- TypeScript strict mode 必须过
- ESLint + Prettier 自动格式化（pre-commit hook）
- 中文注释 OK，但 commit message 用英文（CI 工具友好）
- 服务命名：`*.ts` 单数（如 `auth.ts`、`order.ts`）；表名复数（`orders`、`users`）
- 路由按业务分组，admin 路由统一 `/admin/<biz>` 前缀
- 不要写 `console.log`，用 `console.error`（错误）或不打印

## 9. 不要做的事

- ✗ 跨模块直接改代码（涉及多模块 → 拆成多个 PR）
- ✗ 在 client（apps/web）import server-only 包（`@sentry/node` / `postgres` / `stripe`）
- ✗ 在 LLM prompt 里自称"AI"
- ✗ 在客户端代码里写"价格守门"NLP 检测之类（已撤功能）
- ✗ 跳过 e2e 测试直接合 PR
- ✗ schema 改了没写 down.sql

## 10. 不知道做什么从哪开始

看 `v1/TECH-DEBT.md`：

- P2 列表里挑一个（如 D-301 packages/ui 加 Button 组件）
- 或 issue 标签 `good-first-issue`

## 11. 有问题问谁

- 业务规则：先看 `v1/CLAUDE.md` + 对应模块 `v1/modules/M0X-*.md`
- 代码风格：先看 `ARCHITECTURE.md`
- 上线 / 部署：先看 `LAUNCH.md` + `DEPLOY.md`
- 还不清楚：开 Discussion，不要直接 PR
