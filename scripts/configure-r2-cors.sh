#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env.production
set +a
pnpm --filter @loverush/db exec tsx ../../scripts/configure-r2-cors.ts
