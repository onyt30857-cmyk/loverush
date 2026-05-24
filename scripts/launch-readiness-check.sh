#!/usr/bin/env bash
# 上线就绪自检 · Phase 30
#
# 一键检查 LAUNCH.md §0/§1/§3 列出的全部上线前置条件，输出 PASS/WARN/FAIL 表格，
# 末尾给 READY=GO|NO-GO 结论。
#
# 用法：
#   bash scripts/launch-readiness-check.sh                # 本地（含 dev stack）
#   API=https://api.loverush.com ENV_FILE=.env.production \
#     bash scripts/launch-readiness-check.sh              # 生产
#
# 退出码：
#   0 = READY=GO（全部 PASS 或仅 WARN）
#   1 = NO-GO（至少 1 个 FAIL）
#
# 设计原则：
#   - 凭证缺失 → FAIL（上线前必须配齐）
#   - 工具/服务不可达 → FAIL
#   - 灰度可降级项（VAPID / Stripe stub）缺失 → WARN（不阻塞）
#   - 检查只读，不改任何状态

set -o pipefail
# 不用 set -u: 故意检查未设置的 env vars，会触发"unbound variable"误报
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

API="${API:-http://localhost:8787}"
ENV_FILE="${ENV_FILE:-.env.local}"

# 把 libpq 加进 PATH（macOS brew install libpq 默认 keg-only）
if [ -d "/opt/homebrew/opt/libpq/bin" ] && ! command -v psql >/dev/null 2>&1; then
  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

# ───────── 表格输出工具 ─────────
header() {
  echo
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

result() {
  # $1 = PASS|WARN|FAIL · $2 = label · $3 = detail
  local s=$1 label=$2 detail=$3
  case "$s" in
    PASS) printf "  ${GREEN}✓${NC} %-40s ${DIM}%s${NC}\n" "$label" "$detail"; PASS_COUNT=$((PASS_COUNT+1));;
    WARN) printf "  ${YELLOW}⚠${NC} %-40s ${YELLOW}%s${NC}\n" "$label" "$detail"; WARN_COUNT=$((WARN_COUNT+1));;
    FAIL) printf "  ${RED}✗${NC} %-40s ${RED}%s${NC}\n" "$label" "$detail"; FAIL_COUNT=$((FAIL_COUNT+1));;
  esac
}

# ───────── 加载 env 文件（可选） ─────────
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  echo -e "${DIM}已加载 $ENV_FILE${NC}"
fi

# ═════════════════════════════════════════════════════
# §1. 凭证（LAUNCH.md §0 凭证清单）
# ═════════════════════════════════════════════════════
header "§1 凭证清单"

# 必填（缺即 FAIL）
REQUIRED_VARS=(
  "DATABASE_URL:Supabase 主库"
  "JWT_SECRET:JWT 签名（≥ 32 字符）"
  "ANTHROPIC_API_KEY:Claude 主对话"
  "OPENAI_API_KEY:LLM 降级备"
  "UPSTASH_REDIS_REST_URL:限流/缓存"
  "UPSTASH_REDIS_REST_TOKEN:Redis 凭证"
)
for entry in "${REQUIRED_VARS[@]}"; do
  IFS=':' read -r var label <<< "$entry"
  val="${!var:-}"
  if [ -z "$val" ]; then
    result FAIL "$var" "未设置（$label）"
  elif [ "$var" = "JWT_SECRET" ] && [ "${#val}" -lt 32 ]; then
    result FAIL "$var" "长度 ${#val} < 32"
  else
    result PASS "$var" "已设置（${#val} 字符）"
  fi
done

# 可降级（缺只 WARN）
OPTIONAL_VARS=(
  "GOOGLE_GEMINI_API_KEY:Gemini T2 备路径（缺则无 T2 降级）"
  "VAPID_PUBLIC_KEY:Web Push（缺自动 stub）"
  "VAPID_PRIVATE_KEY:Web Push 私钥（缺自动 stub）"
  "R2_ACCESS_KEY_ID:R2 媒体（缺自动 stub）"
  "R2_SECRET_ACCESS_KEY:R2 媒体（缺自动 stub）"
  "STRIPE_SECRET_KEY:充值通道（缺自动 stub）"
  "SENTRY_DSN:错误监控（缺则丢失生产 5xx 可见性）"
)
for entry in "${OPTIONAL_VARS[@]}"; do
  IFS=':' read -r var label <<< "$entry"
  val="${!var:-}"
  if [ -z "$val" ]; then
    result WARN "$var" "未设置（$label）"
  else
    result PASS "$var" "已设置"
  fi
done

# ═════════════════════════════════════════════════════
# §2. 数据库（LAUNCH.md §1）
# ═════════════════════════════════════════════════════
header "§2 数据库就位"

if ! command -v psql >/dev/null 2>&1; then
  result FAIL "psql 客户端" "未安装（macOS: brew install libpq）"
elif [ -z "${DATABASE_URL:-}" ]; then
  result FAIL "DB 连接" "DATABASE_URL 未设置，跳过 DB 检查"
elif ! psql "$DATABASE_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  result FAIL "DB 连接" "无法连接 $DATABASE_URL（凭证/网络/防火墙？）"
else
  result PASS "DB 连接" "$DATABASE_URL"

  TABLE_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null || echo 0)
  if [ "$TABLE_COUNT" -ge 50 ]; then
    result PASS "表数（≥ 50）" "$TABLE_COUNT 张"
  elif [ "$TABLE_COUNT" -ge 16 ]; then
    result WARN "表数（≥ 50）" "$TABLE_COUNT 张（仅核心表，建议跑全部迁移）"
  else
    result FAIL "表数（≥ 50）" "$TABLE_COUNT 张（迁移没跑完？）"
  fi

  # 核心 8 张表至少 1 张有数据（避免上线后空跑）
  CORE_TABLES=(users orders points_account therapists invite_codes admin_audit_log feature_flags user_roles)
  has_data=0
  for t in "${CORE_TABLES[@]}"; do
    n=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo 0)
    if [ "$n" -gt 0 ]; then has_data=$((has_data+1)); fi
  done
  if [ "$has_data" -ge 1 ]; then
    result PASS "核心表有数据" "$has_data/${#CORE_TABLES[@]} 张表非空"
  else
    result WARN "核心表有数据" "全部为空（生产首次上线正常 · 演练后应有 seed 数据）"
  fi

  # append-only 触发器（Phase 25）
  TRIG=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_admin_audit_block%'" 2>/dev/null || echo 0)
  if [ "$TRIG" -ge 1 ]; then
    result PASS "审计 append-only 触发器" "已部署"
  else
    result FAIL "审计 append-only 触发器" "缺失（migration 0003 没跑？合规底线）"
  fi
fi

# ═════════════════════════════════════════════════════
# §3. API 端点（LAUNCH.md §3 监控）
# ═════════════════════════════════════════════════════
header "§3 API 端点（$API）"

# /ping
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$API/ping" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  result PASS "GET /ping" "200"
else
  result FAIL "GET /ping" "HTTP $code（API 没起？）"
fi

# /metrics
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$API/metrics" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  metric_count=$(curl -sS --max-time 5 "$API/metrics" 2>/dev/null | grep -c '^loverush_' || echo 0)
  if [ "$metric_count" -ge 13 ]; then
    result PASS "GET /metrics" "$metric_count 个 loverush_* 指标"
  else
    result WARN "GET /metrics" "$metric_count 个指标（期望 ≥ 13）"
  fi
else
  result FAIL "GET /metrics" "HTTP $code"
fi

# /openapi.json（若有暴露）
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$API/openapi.json" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then
  result PASS "GET /openapi.json" "暴露 spec"
else
  result WARN "GET /openapi.json" "HTTP $code（可选，spec 走 infra/openapi/）"
fi

# ═════════════════════════════════════════════════════
# §4. 工具链（Prometheus / OpenAPI / i18n）
# ═════════════════════════════════════════════════════
header "§4 工具链 / CI 阻断项"

# Prometheus rules
if command -v docker >/dev/null 2>&1; then
  if docker run --rm --entrypoint promtool -v "$PROJECT_ROOT/infra/prometheus:/work" -w /work \
       prom/prometheus:v2.54.1 check rules rules.yml >/dev/null 2>&1; then
    result PASS "promtool check rules" "rules.yml 合法"
  else
    result FAIL "promtool check rules" "rules.yml 不合法"
  fi

  if docker run --rm --entrypoint promtool -v "$PROJECT_ROOT/infra/prometheus:/work" -w /work \
       prom/prometheus:v2.54.1 test rules rules.test.yml >/dev/null 2>&1; then
    result PASS "promtool test rules" "9 alert 单测通过"
  else
    result FAIL "promtool test rules" "rules.test.yml 失败"
  fi
else
  result WARN "promtool" "docker 不可用，跳过"
fi

# OpenAPI JSON syntax
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json; json.load(open('infra/openapi/loverush-api.openapi.json'))" 2>/dev/null; then
    result PASS "openapi.json JSON" "合法"
  else
    result FAIL "openapi.json JSON" "解析失败"
  fi
else
  result WARN "openapi.json JSON" "python3 不可用，跳过"
fi

# i18n 6 语种 key 一致
if command -v bun >/dev/null 2>&1; then
  if bun scripts/check-i18n.ts >/dev/null 2>&1; then
    result PASS "i18n 6 语种 key 一致" "通过"
  else
    result FAIL "i18n 6 语种 key 一致" "不一致（跑 bun scripts/check-i18n.ts 看详情）"
  fi
else
  result WARN "i18n 检查" "bun 不可用，跳过"
fi

# ═════════════════════════════════════════════════════
# §5. 结论
# ═════════════════════════════════════════════════════
echo
echo -e "${BLUE}━━━ 结论 ━━━${NC}"
printf "  ${GREEN}PASS${NC} %d  ${YELLOW}WARN${NC} %d  ${RED}FAIL${NC} %d\n" "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "  ${GREEN}READY=GO${NC}（可进入 LAUNCH.md §7 D-Day 流程）"
  if [ "$WARN_COUNT" -gt 0 ]; then
    echo -e "  ${YELLOW}注意 $WARN_COUNT 个 WARN：可降级项缺失，建议补全${NC}"
  fi
  exit 0
else
  echo -e "  ${RED}READY=NO-GO${NC}（修完 $FAIL_COUNT 个 FAIL 再上线）"
  exit 1
fi
