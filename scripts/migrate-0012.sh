#!/usr/bin/env bash
# 应用 0012 地理字典 migration + seed 城市/区域到生产 DB
# 用法:bash scripts/migrate-0012.sh
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: 找不到 .env.production 中的 DATABASE_URL" >&2; exit 1; }

echo "→ 应用 0012 (cities + areas + user_location_preference + therapists 2 cols)..."
psql "$URL" -f packages/db/migrations/0012_geo_dictionary.sql

echo
echo "→ 灌入种子(13 城市 + 8 曼谷区域)..."
psql "$URL" -f packages/db/src/seed/0003_cities_areas_seed.sql

echo
echo "✓ 完成 · 客户 home 位置 chip + /geo + /admin/geo 立即可用"
