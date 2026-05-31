BEGIN;
DROP INDEX IF EXISTS idx_therapists_ai_health_score;
ALTER TABLE therapists DROP COLUMN IF EXISTS ai_kill_switch_reason;
ALTER TABLE therapists DROP COLUMN IF EXISTS ai_health_latest_score;
DROP TABLE IF EXISTS ai_health_scores CASCADE;
COMMIT;
