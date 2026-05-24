# Web Dockerfile · Next.js dev mode（仅用于本地 e2e）
# 生产建议直接部署到 Cloudflare Pages

FROM node:20-alpine
RUN npm i -g pnpm@9.12.0
WORKDIR /app

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

COPY . .

EXPOSE 3000
CMD ["pnpm", "--filter", "@loverush/web", "dev"]
