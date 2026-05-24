#!/usr/bin/env bash
# 轻量灰度健康检查 · Phase 36
#
# 不依赖 admin user / JWT，只查 public 端点。覆盖：
#   - API 存活 (/ping)
#   - DB 连接活 (/metrics 200 + ≥5 metric 行)
#   - 关键指标阈值（audit_pending / risk_unresolved / metrics_error）
#
# 用法：
#   API=https://loverush-production.up.railway.app bash scripts/lightweight-canary.sh
#
#   # cron 示例（每小时整点）
#   0 * * * * /path/to/code/scripts/lightweight-canary.sh \
#     | tee -a /var/log/loverush/canary.log \
#     || curl -X POST "$SLACK_WEBHOOK" -d "{\"text\":\"LoveRush canary FAIL\"}"
#
# 退出码：
#   0 = 全 PASS
#   1 = WARN（指标超阈但端点存活）
#   2 = FAIL（端点挂或返非 200）

set -uo pipefail

API="${API:-https://loverush-production.up.railway.app}"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FAIL=0
WARN=0
PASS=0

# 阈值（业务运营调整时改这里）
THRESH_AUDIT_PENDING_WARN=20
THRESH_AUDIT_PENDING_FAIL=100
THRESH_RISK_UNRESOLVED_WARN=5
THRESH_RISK_UNRESOLVED_FAIL=20
THRESH_METRICS_ERROR_FAIL=1   # metrics_error 指标 >= 1 即 FAIL

# ────── 1. /ping ──────
PING_BODY=$(mktemp)
PING_CODE=$(curl -sS --max-time 8 -o "$PING_BODY" -w '%{http_code}' "$API/ping" 2>/dev/null || echo "000")
PING_BODY=$(cat "$PING_BODY"; rm -f "$PING_BODY")
if [ "$PING_CODE" = "200" ] && echo "$PING_BODY" | grep -q '"status":"ok"'; then
  echo "PASS  /ping 200"
  PASS=$((PASS+1))
else
  echo "FAIL  /ping code=$PING_CODE body=$PING_BODY"
  FAIL=$((FAIL+1))
fi

# ────── 2. /metrics ──────
METRICS_FILE=$(mktemp)
METRICS_CODE=$(curl -sS --max-time 15 -o "$METRICS_FILE" -w '%{http_code}' "$API/metrics" 2>/dev/null || echo "000")
METRICS_BODY=$(cat "$METRICS_FILE")
rm -f "$METRICS_FILE"
if [ "$METRICS_CODE" != "200" ]; then
  echo "FAIL  /metrics code=$METRICS_CODE"
  FAIL=$((FAIL+1))
else
  N_METRICS=$(echo "$METRICS_BODY" | grep -c '^loverush_' || true)
  if [ "$N_METRICS" -ge 5 ]; then
    echo "PASS  /metrics 200 · $N_METRICS metrics"
    PASS=$((PASS+1))
  else
    echo "FAIL  /metrics 200 but only $N_METRICS metrics (expected ≥5 · DB pool likely cold)"
    FAIL=$((FAIL+1))
  fi

  # ────── 3. 关键阈值判定 ──────
  extract_metric() {
    echo "$METRICS_BODY" | grep -E "^$1 [0-9]" | awk '{print $2}' | head -1
  }

  judge_lte() {
    # judge_lte <metric_name> <value> <warn_thresh> <fail_thresh>
    local label=$1 v=$2 warn=$3 fail=$4
    [ -z "$v" ] && { echo "SKIP  $label (no data)"; return; }
    if [ "$v" -ge "$fail" ]; then
      echo "FAIL  $label = $v (≥ $fail)"
      FAIL=$((FAIL+1))
    elif [ "$v" -ge "$warn" ]; then
      echo "WARN  $label = $v (≥ $warn)"
      WARN=$((WARN+1))
    else
      echo "PASS  $label = $v"
      PASS=$((PASS+1))
    fi
  }

  AP=$(extract_metric loverush_audit_pending)
  RU=$(extract_metric loverush_risk_unresolved)
  ME=$(extract_metric loverush_metrics_error)

  judge_lte audit_pending   "$AP" "$THRESH_AUDIT_PENDING_WARN"   "$THRESH_AUDIT_PENDING_FAIL"
  judge_lte risk_unresolved "$RU" "$THRESH_RISK_UNRESOLVED_WARN" "$THRESH_RISK_UNRESOLVED_FAIL"

  if [ -n "$ME" ] && [ "$ME" -ge "$THRESH_METRICS_ERROR_FAIL" ]; then
    echo "FAIL  metrics_error = $ME (handler raised)"
    FAIL=$((FAIL+1))
  fi
fi

echo
echo "── $NOW · API=$API"
echo "── PASS=$PASS  WARN=$WARN  FAIL=$FAIL"

if [ "$FAIL" -gt 0 ]; then exit 2
elif [ "$WARN" -gt 0 ]; then exit 1
else exit 0; fi
