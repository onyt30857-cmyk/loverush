#!/usr/bin/env bash
# 应用 0021 M02b/M04 Phase 1 · 技师发布服务系统
set -euo pipefail
cd "$(dirname "$0")/.."
URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: DATABASE_URL not found" >&2; exit 1; }
echo "→ 应用 0021 (service_categories 字典 + shows 表 + orders.source_show_id)..."
psql "$URL" -f packages/db/migrations/0021_m04_shows.sql
echo
echo "✓ 完成 · 6 个默认服务类型已 seed · shows 表 + 索引就位"
