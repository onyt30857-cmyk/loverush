-- 0033 · 管理后台 Prompt Registry · 提示词模板版本库(分层治理)
-- 来源:packages/db/src/schema/prompt_templates.ts
-- 幂等:IF NOT EXISTS,可重复执行
-- 上线顺序:先在生产跑本迁移,再 push 代码(防部署窗口报表不存在)

BEGIN;

CREATE TABLE IF NOT EXISTS prompt_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text        NOT NULL,
  version      integer     NOT NULL,
  label        text,
  content      text        NOT NULL,
  status       text        NOT NULL DEFAULT 'draft',
  layer        text        NOT NULL DEFAULT 'B',
  change_note  text,
  rollout_pct  integer     NOT NULL DEFAULT 100,
  created_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_templates_key_version
  ON prompt_templates (key, version);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_key_status
  ON prompt_templates (key, status);

COMMIT;
