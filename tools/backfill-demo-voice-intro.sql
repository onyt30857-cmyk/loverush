-- 一次性 backfill · 给所有 voice_intro_url 为空的技师填 demo voice
-- 2026-06-03 · Tony 说当前 admin-seeded 技师都是演示账户 · 统一用 demo voice
-- 真技师后续上传后自动覆盖(PUT /therapists/me 写新 URL)
--
-- 跑法 (按 [[feedback_railway_run_prod_migration]]):
--   railway link <project>   # 选 api service
--   railway run -- bash -c 'psql "$DATABASE_URL" -f tools/backfill-demo-voice-intro.sql'
--
-- demo 资产:
--   en-shimmer · "The way I wait for you... is to dim the lights, first." · OpenAI tts-1-hd · speed 0.9

\set demo_url 'https://pub-bad5a738b21b4f6abc2fb480e5fabe8d.r2.dev/demo/therapist-voice-intro-v1.mp3'

BEGIN;

-- 影响行数预检查
SELECT COUNT(*) AS will_update FROM therapists WHERE voice_intro_url IS NULL;

UPDATE therapists
SET voice_intro_url = :'demo_url',
    updated_at = NOW()
WHERE voice_intro_url IS NULL;

-- 确认写入
SELECT COUNT(*) AS now_with_demo
FROM therapists
WHERE voice_intro_url = :'demo_url';

COMMIT;
