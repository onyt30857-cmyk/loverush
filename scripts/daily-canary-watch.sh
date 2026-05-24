#!/usr/bin/env bash
# 灰度日观测 · Phase 30
#
# LAUNCH.md §9「上线后第一周必做」的自动化：
# 拉 4 个 admin endpoint，按 §3 告警阈值表自动判定 PASS/WARN/FAIL，
# 输出 Markdown 报告（适合 cron 后接 mail/slack/PagerDuty）。
#
# 用法：
#   API=https://api.loverush.com ADMIN_TOKEN=<jwt> \
#     bash scripts/daily-canary-watch.sh
#
#   # 输出到文件（建议 cron 这样用）
#   ... > "reports/canary-$(date +%Y%m%d-%H%M).md"
#
#   # cron 示例：每天 10:00 / 14:00 / 18:00 / 22:00 看一次
#   0 10,14,18,22 * * * /path/to/code/scripts/daily-canary-watch.sh \
#     > /var/log/loverush/canary-$(date +%Y%m%d-%H).md || \
#     curl -X POST $SLACK_WEBHOOK -d "{\"text\":\"canary FAIL\"}"
#
# 退出码：
#   0 = 全 PASS/WARN（继续灰度）
#   1 = 至少 1 个 FAIL（cron 触发 alert）
#   2 = 调用 API 失败（环境问题）

set -uo pipefail

API="${API:-http://localhost:8787}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "ERR: ADMIN_TOKEN 未设置，无法访问 admin 端点" >&2
  exit 2
fi

NOW=$(date +"%Y-%m-%d %H:%M:%S %Z")
FAIL_COUNT=0
WARN_COUNT=0
PASS_COUNT=0

# ────── 工具 ──────
fetch_json() {
  curl -sS --max-time 10 -H "Authorization: Bearer $ADMIN_TOKEN" "$1" 2>&1
}

# 取 JSON 字段（无 jq 兜底，jq 优先）
get_field() {
  local json="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$json" | jq -r ".$key // empty" 2>/dev/null
  else
    # 兜底：贪婪 grep，仅支持 "key":number / "key":"value" 顶层
    echo "$json" | grep -o "\"$key\":[^,}]*" | head -1 | sed -E 's/.*:[[:space:]]*//; s/[",]*$//; s/^"//'
  fi
}

# ────── Markdown 头 ──────
cat <<EOF
# Canary Watch · $NOW

环境：\`$API\`

| Endpoint | Metric | Value | Threshold | Result |
|----------|--------|-------|-----------|--------|
EOF

# ────── 1. /admin/dashboard?range_days=1 ──────
DASH=$(fetch_json "$API/admin/dashboard?range_days=1")
if echo "$DASH" | grep -q '"error"\|^Failed'; then
  echo "| /admin/dashboard | — | (call failed) | — | **FAIL** |"
  FAIL_COUNT=$((FAIL_COUNT+1))
else
  # 核心指标按 LAUNCH.md §3 表
  P99=$(get_field "$DASH" "api_p99_latency_ms")
  ERR_RATIO=$(get_field "$DASH" "api_5xx_ratio")
  LLM_FAIL=$(get_field "$DASH" "llm_fail_ratio")
  PAID_RATE=$(get_field "$DASH" "paid_to_completed_rate")
  REFUND_RATE=$(get_field "$DASH" "refund_rate")

  judge() {
    # $1=label $2=value $3=warn阈值 $4=fail阈值 $5=方向 lt|gt
    local label=$1 v=$2 warn=$3 fail=$4 dir=$5
    if [ -z "$v" ] || [ "$v" = "null" ]; then
      echo "| /admin/dashboard | $label | (no data) | — | WARN |"; WARN_COUNT=$((WARN_COUNT+1)); return
    fi
    if [ "$dir" = "gt" ]; then
      # 越大越糟
      awk -v v="$v" -v w="$warn" -v f="$fail" 'BEGIN{exit !(v>f)}' && {
        echo "| /admin/dashboard | $label | $v | > $fail | **FAIL** |"; FAIL_COUNT=$((FAIL_COUNT+1)); return; }
      awk -v v="$v" -v w="$warn" 'BEGIN{exit !(v>w)}' && {
        echo "| /admin/dashboard | $label | $v | > $warn | WARN |"; WARN_COUNT=$((WARN_COUNT+1)); return; }
      echo "| /admin/dashboard | $label | $v | ≤ $warn | PASS |"; PASS_COUNT=$((PASS_COUNT+1))
    else
      # 越小越糟（如转化率）
      awk -v v="$v" -v w="$warn" -v f="$fail" 'BEGIN{exit !(v<f)}' && {
        echo "| /admin/dashboard | $label | $v | < $fail | **FAIL** |"; FAIL_COUNT=$((FAIL_COUNT+1)); return; }
      awk -v v="$v" -v w="$warn" 'BEGIN{exit !(v<w)}' && {
        echo "| /admin/dashboard | $label | $v | < $warn | WARN |"; WARN_COUNT=$((WARN_COUNT+1)); return; }
      echo "| /admin/dashboard | $label | $v | ≥ $warn | PASS |"; PASS_COUNT=$((PASS_COUNT+1))
    fi
  }

  judge "API p99 latency ms"  "$P99"         800   2000  gt
  judge "API 5xx ratio %"     "$ERR_RATIO"   0.5   2     gt
  judge "LLM fail ratio %"    "$LLM_FAIL"    3     10    gt
  judge "PAID→COMPLETED %"    "$PAID_RATE"   90    80    lt
  judge "refund rate %"       "$REFUND_RATE" 3     8     gt
fi

# ────── 2. /admin/risk/events?unresolved_only=true ──────
RISK=$(fetch_json "$API/admin/risk/events?unresolved_only=true")
if echo "$RISK" | grep -q '"error"\|^Failed'; then
  echo "| /admin/risk/events | — | (call failed) | — | **FAIL** |"
  FAIL_COUNT=$((FAIL_COUNT+1))
else
  COUNT=$(get_field "$RISK" "total")
  COUNT="${COUNT:-0}"
  if [ "$COUNT" -le 10 ]; then
    echo "| /admin/risk/events | unresolved count | $COUNT | ≤ 10 | PASS |"
    PASS_COUNT=$((PASS_COUNT+1))
  elif [ "$COUNT" -le 30 ]; then
    echo "| /admin/risk/events | unresolved count | $COUNT | ≤ 30 | WARN |"
    WARN_COUNT=$((WARN_COUNT+1))
  else
    echo "| /admin/risk/events | unresolved count | $COUNT | > 30 | **FAIL** |"
    FAIL_COUNT=$((FAIL_COUNT+1))
  fi
fi

# ────── 3. /admin/audit/queue?status=pending ──────
AUDIT=$(fetch_json "$API/admin/audit/queue?status=pending")
if echo "$AUDIT" | grep -q '"error"\|^Failed'; then
  echo "| /admin/audit/queue | — | (call failed) | — | **FAIL** |"
  FAIL_COUNT=$((FAIL_COUNT+1))
else
  COUNT=$(get_field "$AUDIT" "total")
  COUNT="${COUNT:-0}"
  if [ "$COUNT" -le 20 ]; then
    echo "| /admin/audit/queue | pending count | $COUNT | ≤ 20 | PASS |"
    PASS_COUNT=$((PASS_COUNT+1))
  elif [ "$COUNT" -le 50 ]; then
    echo "| /admin/audit/queue | pending count | $COUNT | ≤ 50 | WARN |"
    WARN_COUNT=$((WARN_COUNT+1))
  else
    echo "| /admin/audit/queue | pending count | $COUNT | > 50 | **FAIL** |"
    FAIL_COUNT=$((FAIL_COUNT+1))
  fi
fi

# ────── 4. /admin/tickets?status=open ──────
TICKETS=$(fetch_json "$API/admin/tickets?status=open")
if echo "$TICKETS" | grep -q '"error"\|^Failed'; then
  echo "| /admin/tickets | — | (call failed) | — | **FAIL** |"
  FAIL_COUNT=$((FAIL_COUNT+1))
else
  COUNT=$(get_field "$TICKETS" "total")
  COUNT="${COUNT:-0}"
  if [ "$COUNT" -le 20 ]; then
    echo "| /admin/tickets | open count | $COUNT | ≤ 20 | PASS |"
    PASS_COUNT=$((PASS_COUNT+1))
  elif [ "$COUNT" -le 50 ]; then
    echo "| /admin/tickets | open count | $COUNT | ≤ 50 | WARN |"
    WARN_COUNT=$((WARN_COUNT+1))
  else
    echo "| /admin/tickets | open count | $COUNT | > 50 | **FAIL** |"
    FAIL_COUNT=$((FAIL_COUNT+1))
  fi
fi

# ────── 总结 ──────
cat <<EOF

---

## Summary

- PASS: $PASS_COUNT
- WARN: $WARN_COUNT
- FAIL: $FAIL_COUNT

EOF

if [ "$FAIL_COUNT" -gt 0 ]; then
  cat <<EOF
**🚨 Action**: 至少 1 个 FAIL，按 LAUNCH.md §4 回滚预案分级处置：
- API 5xx > 2% → 检查 Sentry · 考虑暂停灰度推进
- LLM fail > 10% → 检查 provider 状态 · 必要时 \`flag llm_force_openai\`
- risk events > 30 → 立即 review，可能有刷号/欺诈
EOF
  exit 1
fi

if [ "$WARN_COUNT" -gt 0 ]; then
  echo "**⚠ Note**: $WARN_COUNT 个 WARN，灰度可继续但注意趋势。"
fi

exit 0
