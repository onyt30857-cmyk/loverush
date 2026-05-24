#!/usr/bin/env bash
# LoveRush 数据库定时备份
# 对应 OPERATIONS.md §13 备份与恢复
#
# 部署：
#   1. 复制到 /opt/loverush/scripts/backup-cron.sh
#   2. chmod +x
#   3. /etc/cron.d/loverush-backup 写：
#        0 3 * * *  loverush  /opt/loverush/scripts/backup-cron.sh >> /var/log/loverush/backup.log 2>&1
#
# 环境变量（来自 /etc/loverush/backup.env，必须 chmod 600）：
#   PG_DUMP_URL              postgres://user:pass@host:5432/db   # 只读账号即可
#   R2_BUCKET                loverush-backups
#   R2_ACCESS_KEY_ID
#   R2_SECRET_ACCESS_KEY
#   R2_ENDPOINT              https://<account>.r2.cloudflarestorage.com
#   RETAIN_DAILY_DAYS        7    # 保留几天的日备份
#   RETAIN_WEEKLY_WEEKS      8    # 保留几周的周备份（周日的备份升为周备份）
#   ALERT_WEBHOOK            https://...  # 任意 Slack/飞书/钉钉 webhook，失败时 POST
#
# 退出码：0 = 成功；非 0 = 失败（cron 会按 MAILTO 报警，同时触发 webhook）

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
RETAIN_DAILY_DAYS="${RETAIN_DAILY_DAYS:-7}"
RETAIN_WEEKLY_WEEKS="${RETAIN_WEEKLY_WEEKS:-8}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DAY_OF_WEEK="$(date -u +%u)"   # 1=周一, 7=周日
TMP_DIR="$(mktemp -d /tmp/loverush-backup-XXXXXX)"
DUMP_FILE="$TMP_DIR/loverush-${TS}.sql.gz"
LOG_PREFIX="[backup ${TS}]"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

alert() {
  local msg="$1"
  echo "$LOG_PREFIX FAIL: $msg" >&2
  if [[ -n "$ALERT_WEBHOOK" ]]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      --max-time 10 \
      -d "{\"text\":\"loverush backup FAIL ${TS}: ${msg}\"}" \
      "$ALERT_WEBHOOK" || true
  fi
}

# 1. pg_dump → gzip
echo "$LOG_PREFIX step 1/3: pg_dump"
if ! pg_dump --no-owner --no-acl --format=plain "$PG_DUMP_URL" | gzip -9 > "$DUMP_FILE"; then
  alert "pg_dump failed"
  exit 1
fi
SIZE_BYTES="$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")"
if [[ "$SIZE_BYTES" -lt 1024 ]]; then
  alert "dump file suspiciously small (${SIZE_BYTES} bytes)"
  exit 1
fi
echo "$LOG_PREFIX   dump size: ${SIZE_BYTES} bytes"

# 2. 上传 R2（每日目录；周日同时复制到 weekly/）
echo "$LOG_PREFIX step 2/3: upload to R2"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

DAILY_KEY="daily/loverush-${TS}.sql.gz"
if ! aws s3 cp "$DUMP_FILE" "s3://${R2_BUCKET}/${DAILY_KEY}" \
       --endpoint-url "$R2_ENDPOINT" --only-show-errors; then
  alert "upload daily failed"
  exit 1
fi
echo "$LOG_PREFIX   uploaded: ${DAILY_KEY}"

if [[ "$DAY_OF_WEEK" == "7" ]]; then
  WEEKLY_KEY="weekly/loverush-${TS}.sql.gz"
  if ! aws s3 cp "s3://${R2_BUCKET}/${DAILY_KEY}" "s3://${R2_BUCKET}/${WEEKLY_KEY}" \
         --endpoint-url "$R2_ENDPOINT" --only-show-errors; then
    alert "promote weekly failed"
    exit 1
  fi
  echo "$LOG_PREFIX   promoted to weekly: ${WEEKLY_KEY}"
fi

# 3. 清理过期备份
echo "$LOG_PREFIX step 3/3: prune"
DAILY_CUTOFF="$(date -u -d "${RETAIN_DAILY_DAYS} days ago" +%Y%m%d 2>/dev/null \
              || date -u -v "-${RETAIN_DAILY_DAYS}d" +%Y%m%d)"
WEEKLY_CUTOFF="$(date -u -d "${RETAIN_WEEKLY_WEEKS} weeks ago" +%Y%m%d 2>/dev/null \
               || date -u -v "-${RETAIN_WEEKLY_WEEKS}w" +%Y%m%d)"

prune() {
  local prefix="$1" cutoff="$2"
  aws s3 ls "s3://${R2_BUCKET}/${prefix}/" --endpoint-url "$R2_ENDPOINT" \
    | awk '{print $4}' \
    | while read -r key; do
        [[ -z "$key" ]] && continue
        # 文件名形如 loverush-20260520T030000Z.sql.gz，取日期段
        local d
        d="$(echo "$key" | grep -oE '[0-9]{8}' | head -n1 || true)"
        [[ -z "$d" ]] && continue
        if [[ "$d" < "$cutoff" ]]; then
          aws s3 rm "s3://${R2_BUCKET}/${prefix}/${key}" --endpoint-url "$R2_ENDPOINT" --only-show-errors
          echo "$LOG_PREFIX   pruned: ${prefix}/${key}"
        fi
      done
}
prune daily "$DAILY_CUTOFF"
prune weekly "$WEEKLY_CUTOFF"

echo "$LOG_PREFIX OK"
exit 0
