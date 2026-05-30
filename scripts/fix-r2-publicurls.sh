#!/usr/bin/env bash
# 修复 db 中所有 R2 publicUrl · 去掉多余的 /loverush-media/ 路径
#
# 背景: R2_PUBLIC_URL 之前误配成 'https://pub-xxx.r2.dev/loverush-media' (多了 bucket name)
# 导致 mediaAssets.public_url + therapists.avatar_url + therapists.gallery 里所有 URL 都多了 /loverush-media/
# 而 R2 pub 域已绑定 bucket · 路径里不该带 bucket 名 → 实际访问 401/404
#
# 修法: 批量 REPLACE '.r2.dev/loverush-media/' → '.r2.dev/'
# 幂等: 已经是正确格式的 URL 不会被改

set -euo pipefail
cd "$(dirname "$0")/.."

URL=$(grep '^DATABASE_URL=' .env.production | sed 's/^DATABASE_URL=//')
[ -z "$URL" ] && { echo "ERROR: DATABASE_URL 未找到" >&2; exit 1; }

echo "→ 修复 db 中所有 R2 publicUrl..."

psql "$URL" <<'SQL'
BEGIN;

-- 1. media_assets.public_url
WITH affected AS (
  SELECT COUNT(*) AS n FROM media_assets WHERE public_url LIKE '%.r2.dev/loverush-media/%'
)
SELECT '  media_assets.public_url 待修: ' || n FROM affected;

UPDATE media_assets
SET public_url = REPLACE(public_url, '.r2.dev/loverush-media/', '.r2.dev/')
WHERE public_url LIKE '%.r2.dev/loverush-media/%';

-- 2. therapists.avatar_url
WITH affected AS (
  SELECT COUNT(*) AS n FROM therapists WHERE avatar_url LIKE '%.r2.dev/loverush-media/%'
)
SELECT '  therapists.avatar_url 待修: ' || n FROM affected;

UPDATE therapists
SET avatar_url = REPLACE(avatar_url, '.r2.dev/loverush-media/', '.r2.dev/')
WHERE avatar_url LIKE '%.r2.dev/loverush-media/%';

-- 3. therapists.voice_intro_url / short_video_url(同理 · 即使现在没用到也修)
UPDATE therapists
SET voice_intro_url = REPLACE(voice_intro_url, '.r2.dev/loverush-media/', '.r2.dev/')
WHERE voice_intro_url LIKE '%.r2.dev/loverush-media/%';

UPDATE therapists
SET short_video_url = REPLACE(short_video_url, '.r2.dev/loverush-media/', '.r2.dev/')
WHERE short_video_url LIKE '%.r2.dev/loverush-media/%';

UPDATE therapists
SET liveness_video_url = REPLACE(liveness_video_url, '.r2.dev/loverush-media/', '.r2.dev/')
WHERE liveness_video_url LIKE '%.r2.dev/loverush-media/%';

-- 4. therapists.gallery jsonb · 整个序列化字符串里做 REPLACE 再转回 jsonb
WITH affected AS (
  SELECT COUNT(*) AS n FROM therapists WHERE gallery::text LIKE '%.r2.dev/loverush-media/%'
)
SELECT '  therapists.gallery 待修: ' || n FROM affected;

UPDATE therapists
SET gallery = REPLACE(gallery::text, '.r2.dev/loverush-media/', '.r2.dev/')::jsonb
WHERE gallery::text LIKE '%.r2.dev/loverush-media/%';

COMMIT;
SQL

echo
echo "✓ 完成 · 现在 db 里所有 URL 都是 https://pub-xxx.r2.dev/<purpose>/<key> 格式"
echo "  (前提: 已开 R2 bucket public access + 已改 R2_PUBLIC_URL env)"
