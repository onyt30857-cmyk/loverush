#!/usr/bin/env bash
# 应用 0020 M06 Phase 2 admin AI 管理后台
set -euo pipefail
cd "$(dirname "$0")/.."
URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: DATABASE_URL not found" >&2; exit 1; }
echo "→ 应用 0020 (ai_health_scores 表 + therapists 2 字段)..."
psql "$URL" -f packages/db/migrations/0020_m06_admin_phase2.sql
echo
echo "✓ 完成 · admin AI 健康度评分立即可用 + kill switch 字段在位"
