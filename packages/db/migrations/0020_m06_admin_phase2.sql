-- M06 Phase 2 · admin AI 管理后台增强
-- 1) ai_health_scores 表(日级 snapshot)
-- 2) therapists 加 ai_health_latest_score + ai_kill_switch_reason 2 字段

BEGIN;

-- ────────────────── ai_health_scores ──────────────────
CREATE TABLE IF NOT EXISTS ai_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_date date NOT NULL,

  overall_score integer NOT NULL,             -- 0-100

  -- 4 维子分透明 admin 可见
  redline_freq_score integer NOT NULL,         -- 0-40
  simhash_repeat_score integer NOT NULL,       -- 0-25
  negative_feedback_score integer NOT NULL,    -- 0-20
  volume_score integer NOT NULL,               -- 0-15

  window_days integer NOT NULL DEFAULT 7,

  -- 原始指标 jsonb 给 admin 看明细
  metrics jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_health_therapist_date
  ON ai_health_scores (therapist_user_id, score_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_health_therapist_date
  ON ai_health_scores (therapist_user_id, score_date);

CREATE INDEX IF NOT EXISTS idx_ai_health_score_date
  ON ai_health_scores (score_date, overall_score);

-- ────────────────── therapists 加 2 字段 ──────────────────
ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS ai_health_latest_score integer;

ALTER TABLE therapists
  ADD COLUMN IF NOT EXISTS ai_kill_switch_reason text;

-- list 页按 ai_health_latest_score 排序快查
CREATE INDEX IF NOT EXISTS idx_therapists_ai_health_score
  ON therapists (ai_health_latest_score)
  WHERE ai_health_latest_score IS NOT NULL;

COMMIT;
