#!/usr/bin/env bash
# 用 v1/prototypes/images 真人原型图批量补已有技师档案
#
# 用法:
#   bash scripts/seed-prototype-images.sh --dry-run    # 先看计划
#   bash scripts/seed-prototype-images.sh --execute    # 真跑
#
# 自动 source .env.production 注入 DATABASE_URL + R2_*
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "ERROR: .env.production 不存在" >&2
  exit 1
fi

if [ "$#" -ne 1 ] || { [ "$1" != "--dry-run" ] && [ "$1" != "--execute" ]; }; then
  echo "用法: bash scripts/seed-prototype-images.sh [--dry-run|--execute]" >&2
  exit 1
fi

# 把 .env.production 所有变量注入 process.env
set -a
# shellcheck disable=SC1091
source .env.production
set +a

# 跑 TS 脚本
pnpm --filter @loverush/db exec tsx ../../scripts/seed-prototype-images.ts "$1"
