#!/usr/bin/env bash
# 应用 0013 私聊可用性修复 migration
# 用法:bash scripts/migrate-0013.sh
set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: 找不到 .env.production 中的 DATABASE_URL" >&2; exit 1; }

echo "→ 应用 0013 (conversation_read_state + messages.redline_action/flags)..."
psql "$URL" -f packages/db/migrations/0013_chat_unread_redline.sql

echo
echo "✓ 完成 · 私聊未读数 + 红线追踪立即可用"
