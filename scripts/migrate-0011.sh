#!/usr/bin/env bash
# 应用 0011 通知群发 migration 到生产 DB
# 用法:bash scripts/migrate-0011.sh
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: 找不到 .env.production 中的 DATABASE_URL" >&2; exit 1; }

echo "→ 应用 0011 (notification_broadcasts + deliveries)..."
psql "$URL" -f packages/db/migrations/0011_notification_broadcasts.sql
echo
echo "✓ 完成 · admin 'broadcasts' 路由立即可用"
