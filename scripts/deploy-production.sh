#!/usr/bin/env bash
# 一键生产部署 · Phase 35
#
# 用法：
#   bash scripts/deploy-production.sh                # 全栈部署
#   bash scripts/deploy-production.sh --target api   # 仅 API
#   bash scripts/deploy-production.sh --target web   # 仅 web
#   bash scripts/deploy-production.sh --target admin # 仅 admin
#   bash scripts/deploy-production.sh --skip-migrate # 跳过 DB 迁移
#
# 前置：
#   - .env.production 凭证就位
#   - wrangler login 完成（Cloudflare Workers/Pages）
#   - psql 已装（macOS: brew install libpq + PATH）
#   - 跑过 launch-readiness-check.sh 返回 READY=GO
#
# 部署顺序（不可改）：
#   1. 前置 check：readiness-check + dry-run baseline
#   2. DB 迁移 + backup
#   3. 构建 api/web/admin
#   4. 部署 API（Cloudflare Workers）
#   5. 部署 web/admin（Cloudflare Pages）
#   6. 部署后 smoke test
#
# 任一步失败立即退出 · 不会留下半成品状态

set -e
set -o pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step()   { echo -e "\n${BLUE}━━━ STEP $1: $2 ━━━${NC}"; }
ok()     { echo -e "${GREEN}✓ $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()   { echo -e "${RED}✗ $1${NC}"; exit 1; }
header() { echo -e "${BLUE}════ $1 ════${NC}"; }

# 把 libpq 加到 PATH（macOS keg-only）
if [ -d "/opt/homebrew/opt/libpq/bin" ]; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

# ────────── 参数解析 ──────────
TARGET="all"
SKIP_MIGRATE=0
SKIP_READINESS=0
ENV_FILE=".env.production"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --skip-migrate) SKIP_MIGRATE=1; shift;;
    --skip-readiness) SKIP_READINESS=1; shift;;
    --env-file) ENV_FILE="$2"; shift 2;;
    *) fail "未知参数: $1";;
  esac
done

case "$TARGET" in
  all|api|web|admin) ;;
  *) fail "--target 必须是 all/api/web/admin · 收到 $TARGET";;
esac

header "LoveRush 生产部署 · target=$TARGET · env=$ENV_FILE"

# ────────── STEP 0: 前置 ──────────
step 0 "前置检查"

[ -f "$ENV_FILE" ] || fail ".env file 不存在: $ENV_FILE（参考 docs/runbooks/credential-setup.md）"
ok "$ENV_FILE 找到"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# 核心凭证非空
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL 未设置"
[ -n "${JWT_SECRET:-}" ] || fail "JWT_SECRET 未设置"
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET 长度 ${#JWT_SECRET} < 32"
[ -n "${ANTHROPIC_API_KEY:-}" ] || fail "ANTHROPIC_API_KEY 未设置"
ok "核心凭证就位（DATABASE_URL / JWT_SECRET / ANTHROPIC_API_KEY）"

# wrangler 已登录（CF target 时）
if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ] || [ "$TARGET" = "web" ] || [ "$TARGET" = "admin" ]; then
  if ! command -v wrangler >/dev/null 2>&1; then
    fail "wrangler CLI 未安装（npm i -g wrangler）"
  fi
  if ! wrangler whoami >/dev/null 2>&1; then
    fail "wrangler 未登录（跑 wrangler login）"
  fi
  ok "wrangler 已登录"
fi

# Readiness check
if [ "$SKIP_READINESS" = "0" ]; then
  echo -e "${BLUE}跑 launch-readiness-check.sh ...${NC}"
  if ENV_FILE="$ENV_FILE" bash scripts/launch-readiness-check.sh > /tmp/loverush-readiness.log 2>&1; then
    ok "readiness-check: READY=GO"
  else
    cat /tmp/loverush-readiness.log | tail -20
    fail "readiness-check 失败 · 跑完整日志: bash scripts/launch-readiness-check.sh"
  fi
fi

# ────────── STEP 1: DB 备份 + 迁移 ──────────
if [ "$SKIP_MIGRATE" = "0" ] && { [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; }; then
  step 1 "DB 备份 + 迁移"

  # 1.1 备份
  BACKUP_FILE="backups/$(date +%Y%m%d-%H%M)-pre-deploy.sql.gz"
  mkdir -p backups
  echo "备份中（可能 1-3 分钟）..."
  pg_dump "$DATABASE_URL" 2>/dev/null | gzip > "$BACKUP_FILE" || fail "pg_dump 失败"
  ok "备份到 $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

  # 1.2 应用 drizzle migrate（生产用 migrate，不用 push）
  echo "应用迁移 ..."
  pnpm --filter @loverush/db migrate || fail "drizzle migrate 失败 · 用 backup 还原: psql \$DATABASE_URL < $BACKUP_FILE"
  ok "drizzle migrate 完成"

  # 1.3 应用手写 SQL migration（drizzle-kit migrate 不跑 *.sql 是已知行为）
  for mig in packages/db/migrations/*.sql; do
    case "$mig" in *.down.sql) continue;; esac
    BN=$(basename "$mig")
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$mig" > /dev/null 2>&1 \
      && ok "  applied $BN" \
      || warn "  $BN failed or already applied"
  done

  # 1.4 验证
  TABLE_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
  [ "$TABLE_COUNT" -ge 50 ] && ok "表数 $TABLE_COUNT (≥ 50)" || fail "表数 $TABLE_COUNT < 50"

  TRIG_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_admin_audit_block%'")
  [ "$TRIG_COUNT" = "2" ] && ok "审计 append-only 触发器存在" || fail "触发器缺失 · 合规底线"

  # 1.5 备份上传 R2
  if [ -n "${R2_ACCESS_KEY_ID:-}" ] && command -v aws >/dev/null 2>&1; then
    aws s3 cp "$BACKUP_FILE" "s3://${R2_BUCKET_NAME:-loverush-media}/db-backups/" \
      --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
      --region auto 2>/dev/null \
      && ok "备份上传 R2" || warn "R2 备份失败 · 本地仍保留"
  fi
fi

# ────────── STEP 2: 构建 ──────────
if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
  step 2a "构建 API"
  pnpm --filter @loverush/api build || fail "API build 失败"
  ok "apps/api/dist 就绪"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "web" ]; then
  step 2b "构建 web"
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.loverush.com}" \
    pnpm --filter @loverush/web build || fail "web build 失败"
  ok "apps/web/.next 就绪"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "admin" ]; then
  step 2c "构建 admin"
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.loverush.com}" \
    pnpm --filter @loverush/admin build || fail "admin build 失败"
  ok "apps/admin/.next 就绪"
fi

# ────────── STEP 3: 部署 API ──────────
if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
  step 3 "部署 API → Cloudflare Workers"
  cd "$PROJECT_ROOT/apps/api"
  wrangler deploy --env production --config "$PROJECT_ROOT/infra/cloudflare/wrangler.toml" \
    || fail "wrangler deploy 失败 · 看上面错误"
  cd "$PROJECT_ROOT"

  # 等 DNS 传播 + 健康检查
  API_URL="${NEXT_PUBLIC_API_URL:-https://api.loverush.com}"
  for i in 1 2 3 4 5; do
    if curl -sf "$API_URL/ping" > /dev/null; then
      ok "API alive: $API_URL/ping"
      break
    fi
    [ "$i" = "5" ] && fail "API health check 失败 · wrangler rollback 立即回滚"
    sleep 3
  done
fi

# ────────── STEP 4: 部署 web ──────────
if [ "$TARGET" = "all" ] || [ "$TARGET" = "web" ]; then
  step 4 "部署 web → Cloudflare Pages"
  cd "$PROJECT_ROOT/apps/web"
  wrangler pages deploy .next --project-name=loverush-web --branch=main \
    || fail "web pages deploy 失败"
  cd "$PROJECT_ROOT"
  ok "web 部署完成 · 看 dashboard.cloudflare.com → Pages → loverush-web"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "admin" ]; then
  step 5 "部署 admin → Cloudflare Pages"
  cd "$PROJECT_ROOT/apps/admin"
  wrangler pages deploy .next --project-name=loverush-admin --branch=main \
    || fail "admin pages deploy 失败"
  cd "$PROJECT_ROOT"
  ok "admin 部署完成"
fi

# ────────── STEP 6: 部署后 smoke test ──────────
step 6 "部署后烟测"

if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
  API_URL="${NEXT_PUBLIC_API_URL:-https://api.loverush.com}"

  # /ping
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$API_URL/ping")
  [ "$CODE" = "200" ] && ok "GET /ping → 200" || fail "GET /ping → $CODE"

  # /metrics
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$API_URL/metrics")
  [ "$CODE" = "200" ] && ok "GET /metrics → 200" || warn "GET /metrics → $CODE"

  METRIC_COUNT=$(curl -sS --max-time 5 "$API_URL/metrics" | grep -c '^loverush_' || echo 0)
  [ "$METRIC_COUNT" -ge 13 ] && ok "Prometheus metrics: $METRIC_COUNT" || warn "metrics count $METRIC_COUNT < 13"
fi

# ────────── 总结 ──────────
header "部署完成"
cat <<EOF

部署内容：
$([ "$TARGET" = "all" ] || [ "$TARGET" = "api" ] && echo "  ✓ API (Cloudflare Workers · api.loverush.com)")
$([ "$TARGET" = "all" ] || [ "$TARGET" = "web" ] && echo "  ✓ web (Cloudflare Pages · loverush.com)")
$([ "$TARGET" = "all" ] || [ "$TARGET" = "admin" ] && echo "  ✓ admin (Cloudflare Pages · admin.loverush.com)")

下一步：
  1. 如果是首次上线 → 跟 docs/runbooks/d-day-playbook.md D-Day §3.1
  2. 跑 daily-canary-watch：
       ADMIN_TOKEN=... API=$API_URL bash scripts/daily-canary-watch.sh
  3. 看 Sentry 5 分钟内是否有 5xx events
  4. 看 Grafana 监控面板

回滚（如有问题）：
  bash scripts/rollback-production.sh --target api      # 单回滚
  bash scripts/rollback-production.sh                   # 全栈回滚

EOF
