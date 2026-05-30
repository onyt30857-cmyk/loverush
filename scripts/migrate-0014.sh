#!/usr/bin/env bash
# 应用 0014 收藏表 migration
set -euo pipefail
cd "$(dirname "$0")/.."
URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: DATABASE_URL not found" >&2; exit 1; }
echo "→ 应用 0014 (favorites 收藏表)..."
psql "$URL" -f packages/db/migrations/0014_favorites.sql
echo
echo "✓ 完成 · 技师详情页 ❤️ 收藏立即可用"
