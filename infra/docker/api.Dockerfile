# API Dockerfile · Bun runtime
#
# 多阶段构建：
# 1. deps 阶段：装 pnpm + 全量 workspace 依赖
# 2. runtime 阶段：Bun + 拷贝源码

FROM node:20-alpine AS deps
RUN npm i -g pnpm@9.12.0
WORKDIR /app

# 拷贝 workspace 配置
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/llm/package.json packages/llm/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
COPY packages/utils/package.json packages/utils/

RUN pnpm install --frozen-lockfile=false

# ──────────────── runtime ────────────────
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# 把 deps 装好的 node_modules 软链整套过来
COPY --from=deps /app /app
COPY . .

EXPOSE 8787
CMD ["bun", "--hot", "apps/api/src/index.ts"]
