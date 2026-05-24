#!/usr/bin/env bash
# 生产回滚脚本 · Phase 35
#
# 用法：
#   bash scripts/rollback-production.sh                          # 全栈回滚
#   bash scripts/rollback-production.sh --target api             # 仅 API
#   bash scripts/rollback-production.sh --target db --backup F   # DB 还原
#
# 三种回滚：
#   - API：wrangler rollback（回到上一版本）
#   - web / admin：Cloudflare Pages dashboard 手动选 deployment（脚本提示）
#   - DB：pg_restore from backup（最危险 · 必须明确指定 backup 文件）
#
# 安全规则：
#   - DB 回滚需要 --backup 显式指定，否则拒绝
#   - 任何回滚先验证 wrangler / psql 可用
#   - DB 回滚前再次备份当前状态（防止回滚错了再回滚）

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step() { echo -e "\n${BLUE}━━━ STEP $1: $2 ━━━${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

if [ -d "/opt/homebrew/opt/libpq/bin" ]; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

TARGET="all"
BACKUP_FILE=""
ENV_FILE=".env.production"

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --backup) BACKUP_FILE="$2"; shift 2;;
    --env-file) ENV_FILE="$2"; shift 2;;
    *) fail "未知参数: $1";;
  esac
done

echo -e "${BLUE}════ LoveRush 生产回滚 · target=$TARGET ════${NC}"

# 加载 env
[ -f "$ENV_FILE" ] || fail ".env 不存在: $ENV_FILE"
set -a; . "$ENV_FILE"; set +a

# ────────── API 回滚 ──────────
if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
  step 1 "API 回滚"

  command -v wrangler >/dev/null 2>&1 || fail "wrangler 未装"
  wrangler whoami >/dev/null 2>&1 || fail "wrangler 未登录"

  echo "回滚 API 到上一 deployment ..."
  cd "$PROJECT_ROOT/apps/api"
  wrangler rollback --env production || fail "wrangler rollback 失败"
  cd "$PROJECT_ROOT"
  ok "API 回滚命令完成"

  # 验证
  API_URL="${NEXT_PUBLIC_API_URL:-https://api.loverush.com}"
  sleep 5
  for i in 1 2 3; do
    if curl -sf "$API_URL/ping" > /dev/null; then
      ok "API alive: $API_URL/ping"
      break
    fi
    [ "$i" = "3" ] && fail "API 回滚后健康检查失败 · 紧急 contact Cloudflare support"
    sleep 3
  done
fi

# ────────── web / admin 回滚 ──────────
if [ "$TARGET" = "all" ] || [ "$TARGET" = "web" ]; then
  step 2 "web 回滚（半手动）"
  echo -e "${YELLOW}Cloudflare Pages 不支持 CLI rollback · 请手动操作：${NC}"
  echo "  1. 打开 https://dash.cloudflare.com/?to=/:account/pages/view/loverush-web"
  echo "  2. Deployments → 找上一个 production deployment"
  echo "  3. 三点菜单 → Rollback to this deployment"
  read -r -p "完成后按回车继续 ..."
  ok "web 回滚（用户确认）"
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "admin" ]; then
  step 3 "admin 回滚（半手动）"
  echo -e "${YELLOW}同 web · 在 dash.cloudflare.com → pages/loverush-admin 操作${NC}"
  read -r -p "完成后按回车继续 ..."
  ok "admin 回滚"
fi

# ────────── DB 回滚（仅在 --target db 时） ──────────
if [ "$TARGET" = "db" ]; then
  step 4 "DB 回滚"

  [ -n "$BACKUP_FILE" ] || fail "DB 回滚必须指定 --backup <file> · 防止误操作"
  [ -f "$BACKUP_FILE" ] || fail "backup 文件不存在: $BACKUP_FILE"

  command -v psql >/dev/null 2>&1 || fail "psql 未装"
  command -v pg_restore >/dev/null 2>&1 || fail "pg_restore 未装"

  # 4.1 二次确认
  echo -e "${RED}⚠️ DB 回滚是不可逆操作${NC}"
  echo "  目标 DB: $DATABASE_URL"
  echo "  回滚到: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  echo "  当前 DB 状态会被覆盖 · 数据丢失窗口 = backup 时间到现在"
  read -r -p "输入 'I-UNDERSTAND-DATA-LOSS' 继续 ..." CONFIRM
  [ "$CONFIRM" = "I-UNDERSTAND-DATA-LOSS" ] || fail "确认失败"

  # 4.2 备份当前状态（防止回滚错了再回滚）
  CURRENT_BACKUP="backups/$(date +%Y%m%d-%H%M)-pre-rollback-dirty.sql.gz"
  pg_dump "$DATABASE_URL" 2>/dev/null | gzip > "$CURRENT_BACKUP" || fail "当前状态备份失败"
  ok "当前状态备份到 $CURRENT_BACKUP"

  # 4.3 还原
  echo "DROP schema public + 还原 ..."
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" > /dev/null
  if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" > /dev/null
  else
    psql "$DATABASE_URL" < "$BACKUP_FILE" > /dev/null
  fi
  ok "数据库还原完成"

  # 4.4 验证
  TABLE_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
  ok "还原后表数: $TABLE_COUNT"
fi

# ────────── 总结 ──────────
echo
echo -e "${BLUE}════ 回滚完成 ════${NC}"
cat <<EOF

立即下一步：
  1. 跑 canary watch 确认服务正常：
       ADMIN_TOKEN=... API=$API_URL bash scripts/daily-canary-watch.sh
  2. Slack #loverush-incidents 公告回滚原因 + 后续修复计划
  3. 写 incident retro（什么坏了 / 为什么没发现 / 怎么防止再发）

EOF
