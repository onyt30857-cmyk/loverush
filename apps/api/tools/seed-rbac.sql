-- 种子：6 系统角色 + 各角色权限（按现有 requireRole 行为反推，上线零行为差）
-- 幂等：全部 ON CONFLICT DO NOTHING
-- admin 不种权限（resolveUserPermissions 对 admin 直接返回全部 ALL_PERMISSION_KEYS）
-- agent 角色不进后台 catalog（C 端代理，独立 /agent/* 路由）

-- ─── 1. 系统角色目录 ────────────────────────────────────────────────────────
INSERT INTO roles (key, name_zh, description, is_system) VALUES
  ('admin',   '超级管理员', '平台超管，拥有全部权限', true),
  ('auditor', '审核员',     '内容/媒体/Profile 审核，可审技师资料与对话', true),
  ('finance', '财务',       '资金流水、提现审批、法币字典维护', true),
  ('cs',      '客服',       '工单、订单、仲裁、Prompt 模板管理', true),
  ('ops',     '运营',       '经营看板、地理、搜索、群发、灰度开关、AI 规则', true),
  ('agent',   '代理',       'C 端积分代理（不进后台）', true)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. auditor 权限 ────────────────────────────────────────────────────────
-- 对应现有 requireRole: auditor 可访问：
--   admin.ts:  /audit/*, /therapists/verifications, /therapists/batch-verify, /therapists/:userId/verify
--   admin.ts:  /ai/conversations (requireRole admin|auditor)
--   admin-therapist-profile.ts:   requireRole admin|cs|auditor|ops
--   admin-user-media.ts:          requireRole admin|cs|auditor|ops
--   admin-system-errors.ts:       requireRole admin|ops|auditor
--   admin-match.ts:               requireRole admin|cs|auditor|ops
--   admin-customer-assistant.ts:  requireRole admin|cs|auditor|ops
--   admin-assistant-sessions.ts:  requireRole admin|cs|auditor|ops
--   admin-therapist-ai-risk.ts:   requireRole admin|cs|auditor|ops
INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('auditor', 'verifications'),
  ('auditor', 'therapists'),
  ('auditor', 'users.therapists'),
  ('auditor', 'ai.conversations'),
  ('auditor', 'ai.assistant.sessions'),
  ('auditor', 'ai.matching'),
  ('auditor', 'ai.messages'),
  ('auditor', 'ai.assistant-profiles'),
  ('auditor', 'audit'),
  ('auditor', 'system-errors')
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ─── 3. finance 权限 ────────────────────────────────────────────────────────
-- 对应现有 requireRole:
--   admin.ts:      /finance/* requireRole admin|finance|ops
--   commerce.ts:   adminWithdrawRoutes requireRole admin|finance
--   platform.ts:   adminPlatformRoutes requireRole admin|finance
--   currencies.ts: adminCurrenciesRoutes + adminExchangeRatesRoutes requireRole admin|finance
--   redeem.ts:     adminRedeemRoutes requireRole admin（finance 暂未覆盖，按 spec §5 finance 包含积分回收）
--   agents.ts:     adminAgentRoutes requireRole admin（代理商后台，finance 按 spec 包含）
INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('finance', 'finance'),
  ('finance', 'withdrawals'),
  ('finance', 'platform-accounts'),
  ('finance', 'currencies'),
  ('finance', 'exchange-rates'),
  ('finance', 'redeem'),
  ('finance', 'purchases'),
  ('finance', 'agents')
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ─── 4. cs（客服）权限 ───────────────────────────────────────────────────────
-- 对应现有 requireRole:
--   admin-users.ts:              requireRole admin|cs
--   orders.ts:                   adminOrderRoutes requireRole admin|cs
--   reviews.ts:                  adminReviewRoutes requireRole admin|cs
--   admin-disputes.ts:           requireRole admin|cs
--   tickets.ts:                  adminTicketRoutes requireRole admin|cs
--   admin-prompts.ts:            requireRole admin|cs
--   admin-therapist-profile.ts:  requireRole admin|cs|auditor|ops
--   admin-therapist-private.ts:  requireRole admin|cs
--   admin-user-media.ts:         requireRole admin|cs|auditor|ops
--   admin-match.ts:              requireRole admin|cs|auditor|ops
--   admin-customer-assistant.ts: requireRole admin|cs|auditor|ops
--   admin-assistant-sessions.ts: requireRole admin|cs|auditor|ops
--   admin-therapist-ai-risk.ts:  requireRole admin|cs|auditor|ops
--   admin.ts /ai/*:              requireRole admin|ops|cs (AI 规则/健康/代发/画像)
INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('cs', 'users.customers'),
  ('cs', 'users.therapists'),
  ('cs', 'therapists'),
  ('cs', 'orders'),
  ('cs', 'reviews'),
  ('cs', 'disputes'),
  ('cs', 'tickets'),
  ('cs', 'prompts'),
  ('cs', 'ai.system'),
  ('cs', 'ai.health'),
  ('cs', 'ai.messages'),
  ('cs', 'ai.assistant-profiles'),
  ('cs', 'ai.assistant.sessions'),
  ('cs', 'ai.matching'),
  ('cs', 'voice')
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- ─── 5. ops（运营）权限 ──────────────────────────────────────────────────────
-- 对应现有 requireRole:
--   dashboard.ts:              adminDashboardRoutes requireRole admin|ops
--   admin.ts /matching-health: requireRole admin|ops
--   admin.ts /shows:           requireRole admin|ops
--   admin.ts /risk/*:          requireRole admin|ops
--   admin.ts /ai/*:            requireRole admin|ops|cs
--   admin-geo.ts:              requireRole admin|ops
--   admin-search.ts:           requireRole admin|ops
--   flags.ts:                  adminFlagRoutes requireRole admin|ops
--   analytics.ts:              adminAnalyticsRoutes requireRole admin|ops
--   admin-broadcasts.ts:       requireRole admin|ops
--   admin-system-errors.ts:    requireRole admin|ops|auditor
--   admin-therapist-profile.ts: requireRole admin|cs|auditor|ops
--   admin-user-media.ts:       requireRole admin|cs|auditor|ops
--   admin-match.ts:            requireRole admin|cs|auditor|ops
--   admin-customer-assistant.ts: requireRole admin|cs|auditor|ops
--   admin-assistant-sessions.ts: requireRole admin|cs|auditor|ops
--   admin-therapist-ai-risk.ts:  requireRole admin|cs|auditor|ops
--   admin-voice.ts:            requireRole admin|cs|ops
INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('ops', 'dashboard'),
  ('ops', 'matching-health'),
  ('ops', 'shows'),
  ('ops', 'risk'),
  ('ops', 'system-errors'),
  ('ops', 'ai.system'),
  ('ops', 'ai.health'),
  ('ops', 'ai.kill-switch'),
  ('ops', 'ai.messages'),
  ('ops', 'ai.assistant-profiles'),
  ('ops', 'ai.assistant.sessions'),
  ('ops', 'ai.matching'),
  ('ops', 'ai.redline'),
  ('ops', 'ai.cost'),
  ('ops', 'voice'),
  ('ops', 'geo.dashboard'),
  ('ops', 'geo.supply-demand'),
  ('ops', 'geo.countries'),
  ('ops', 'geo.cities'),
  ('ops', 'geo.areas'),
  ('ops', 'search.analytics'),
  ('ops', 'search.keywords'),
  ('ops', 'search.categories'),
  ('ops', 'flags'),
  ('ops', 'broadcasts'),
  ('ops', 'broadcasts.new'),
  ('ops', 'therapists'),
  ('ops', 'users.therapists'),
  ('ops', 'finance')
ON CONFLICT (role_key, permission_key) DO NOTHING;
