#!/usr/bin/env bash
# 紧急 hotfix · 给生产 users 表加 activated_at 列
# 修 register E9999(commit 23db9ee 漏 apply migration)
#
# 用法:从仓库根目录运行
#   bash scripts/hotfix-0009b.sh
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: 找不到 .env.production 中的 DATABASE_URL" >&2; exit 1; }

echo "→ 应用 0009b 紧急 hotfix(加 activated_at 列)..."
psql "$URL" -f packages/db/migrations/0009b_users_activated_at_hotfix.sql
echo
echo "✓ 完成 · register 应已恢复"
