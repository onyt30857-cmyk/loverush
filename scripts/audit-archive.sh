#!/usr/bin/env bash
# 月度审计归档 · Phase 27
#
# 把上个月的 admin_audit_log 行导出为 CSV.gz 上传 R2，主表 **不删**（append-only）。
# 归档不是删除：合规要求 LoveRush 保留可重建审计的能力 ≥ 5 年。
#
# 部署：
#   /etc/cron.d/loverush-audit-archive:
#     0 4 1 * *  loverush  /opt/loverush/scripts/audit-archive.sh >> /var/log/loverush/audit-archive.log 2>&1
#   (每月 1 号 04:00 UTC 跑)
#
# 环境变量（/etc/loverush/backup.env，与 backup-cron.sh 共用）：
#   PG_DUMP_URL  ·  R2_BUCKET  ·  R2_ACCESS_KEY_ID  ·  R2_SECRET_ACCESS_KEY  ·  R2_ENDPOINT
#   ALERT_WEBHOOK（选填）
#
# 失败处理：dump 体积 < 50 字节（仅 header）会告警 — 上个月空审计 = admin 没操作 = 异常

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/loverush/backup.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${PG_DUMP_URL:?PG_DUMP_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

# 上个月（UTC）的第一天 00:00 ~ 本月第一天 00:00 (exclusive)
TODAY_UTC="$(date -u +%Y-%m-01)"
LAST_MONTH_START="$(date -u -d "${TODAY_UTC} -1 month" +%Y-%m-01 2>/dev/null \
                  || date -u -v -1m -j -f "%Y-%m-%d" "${TODAY_UTC}" +%Y-%m-01)"
LAST_MONTH_END="$TODAY_UTC"
LAST_MONTH_TAG="$(echo "$LAST_MONTH_START" | cut -c1-7)"  # YYYY-MM

TMP_DIR="$(mktemp -d /tmp/loverush-audit-archive-XXXXXX)"
CSV_FILE="$TMP_DIR/audit-${LAST_MONTH_TAG}.csv.gz"
LOG_PREFIX="[audit-archive ${LAST_MONTH_TAG}]"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

alert() {
  local msg="$1"
  echo "$LOG_PREFIX FAIL: $msg" >&2
  if [[ -n "$ALERT_WEBHOOK" ]]; then
    curl -fsS -X POST -H 'Content-Type: application/json' --max-time 10 \
      -d "{\"text\":\"audit-archive FAIL ${LAST_MONTH_TAG}: ${msg}\"}" \
      "$ALERT_WEBHOOK" || true
  fi
}

echo "$LOG_PREFIX start · window [${LAST_MONTH_START}, ${LAST_MONTH_END})"

# 用 psql COPY 流式导出 → gzip
# 注意：jsonb 列直接 to_json → 自动单元为合法 JSON 字符串
# CSV HEADER + RFC 4180 引号转义由 psql 内置（FORMAT csv）
psql "$PG_DUMP_URL" -v ON_ERROR_STOP=1 -c "
COPY (
  SELECT
    created_at,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    request_id,
    host(ip) AS ip,
    user_agent,
    before::text,
    after::text
  FROM admin_audit_log
  WHERE created_at >= '${LAST_MONTH_START}'::timestamptz
    AND created_at <  '${LAST_MONTH_END}'::timestamptz
  ORDER BY created_at ASC
) TO STDOUT WITH (FORMAT csv, HEADER true)
" | gzip -9 > "$CSV_FILE" || {
  alert "psql COPY failed"
  exit 1
}

SIZE="$(stat -c%s "$CSV_FILE" 2>/dev/null || stat -f%z "$CSV_FILE")"
if [[ "$SIZE" -lt 50 ]]; then
  alert "archive too small (${SIZE} bytes) — last month had zero audit events?"
  exit 1
fi
echo "$LOG_PREFIX size: ${SIZE} bytes"

# 上传 R2
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
KEY="audit-archive/${LAST_MONTH_TAG}/audit-${LAST_MONTH_TAG}.csv.gz"

aws s3 cp "$CSV_FILE" "s3://${R2_BUCKET}/${KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --only-show-errors \
  --metadata "archived-at=$(date -u +%Y-%m-%dT%H:%M:%SZ),source=admin_audit_log" || {
  alert "R2 upload failed"
  exit 1
}

echo "$LOG_PREFIX OK · uploaded ${KEY}"
echo "$LOG_PREFIX NOTE: main table is NOT pruned. Append-only DB trigger prevents DELETE."
exit 0
