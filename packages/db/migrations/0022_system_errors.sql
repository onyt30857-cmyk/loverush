-- 0022 系统错误聚合表 · admin 监管 + 预警基础
-- 与 risk_events 区分:system_errors 是代码异常(5xx/auth/db/external) · risk_events 是业务安全事件

CREATE TABLE IF NOT EXISTS system_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 去重聚合 key
  fingerprint text NOT NULL,

  -- 分类
  error_type text NOT NULL,                          -- server / auth / validation / db / external / client
  error_code text,                                    -- E0001 等 · null 时未分类
  http_status integer,                                -- 500/502/401 等

  -- 请求上下文
  route text,                                         -- /orders 等
  method text,                                        -- GET/POST 等

  -- 错误细节
  message text NOT NULL,                              -- 脱敏后信息
  stack text,                                          -- 错误栈 · 仅 admin 可见

  -- 严重度 + 计数
  severity integer NOT NULL DEFAULT 50,               -- 0-100 · >=80 高危预警
  count integer NOT NULL DEFAULT 1,

  -- 时间窗
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- 1 条最新样本(脱敏)
  sample_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sample_request_id text,
  sample_payload jsonb DEFAULT '{}'::jsonb,

  -- 处置
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution text,                                    -- fixed / wont_fix / duplicate / external

  created_at timestamptz NOT NULL DEFAULT now()
);

-- partial unique:同 fingerprint 同时只能有 1 个未 resolved 行(upsert 锚)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_errors_active
  ON system_errors (fingerprint) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_errors_last_seen ON system_errors (last_seen_at);
CREATE INDEX IF NOT EXISTS idx_system_errors_severity ON system_errors (severity);
CREATE INDEX IF NOT EXISTS idx_system_errors_unresolved ON system_errors (resolved_at);
CREATE INDEX IF NOT EXISTS idx_system_errors_type ON system_errors (error_type);
