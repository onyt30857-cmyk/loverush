/**
 * 管理后台路由 · M11 + M02
 *
 * 审核
 *   GET    /admin/audit/queue
 *   POST   /admin/audit/:id/approve
 *   POST   /admin/audit/:id/reject
 *
 * 风控
 *   GET    /admin/risk/events
 *   POST   /admin/risk/events/:id/resolve
 *   POST   /admin/risk/blacklist
 *   POST   /admin/risk/price-guard/:therapistId/evaluate
 *
 * TODO: 接入角色校验中间件，确认 caller 是 admin / auditor
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  approveAudit,
  decideVerification,
  listAuditQueue,
  listVerificationQueue,
  rejectAudit,
  type ModerationContext,
} from '../services/moderation';
import {
  addIpToBlacklist,
  evaluatePriceGuard,
  listRiskEvents,
  resolveRiskEvent,
  type RiskContext,
} from '../services/risk';
import { getFinanceOverview, type FinanceContext } from '../services/finance';
import { getMatchingHealth, type MatchingHealthContext } from '../services/matching-health';
import {
  getAiRedlineOverview,
  listAiRedlineLogs,
  getAiCostOverview,
  listAiMessages,
  getAiAssistantProfilesOverview,
  getAiAssistantProfileDetail,
  getAiAssistantMemoryDetail,
  getAiOutreachOverview,
  type AiAdminContext,
} from '../services/ai-admin';

function modCtx(): ModerationContext {
  return { db: getDb() };
}
function riskCtx(): RiskContext {
  return { db: getDb() };
}
function finCtx(): FinanceContext {
  return { db: getDb() };
}
function mhCtx(): MatchingHealthContext {
  return { db: getDb() };
}
function aiCtx(): AiAdminContext {
  return { db: getDb() };
}

export const adminRoutes = new Hono();
adminRoutes.use('*', requireAuth);
// 审核工单需要 admin 或 auditor 角色
// 风控事件 + 黑名单需要 admin 或 ops（运营）角色
// 资金看板需要 admin / finance / ops
adminRoutes.use('/finance/*', requireRole(['admin', 'finance', 'ops']));

adminRoutes.get('/finance/overview', async (c) => {
  const data = await getFinanceOverview(finCtx());
  return c.json({ data });
});

// 派单健康(admin / ops)
adminRoutes.use('/matching-health', requireRole(['admin', 'ops']));
adminRoutes.get('/matching-health', async (c) => {
  const days = c.req.query('range_days') ? parseInt(c.req.query('range_days')!, 10) : 7;
  const data = await getMatchingHealth(mhCtx(), { rangeDays: days });
  return c.json({ data });
});

// ──────────────── AI 治理(admin / ops / cs) ────────────────
adminRoutes.use('/ai/*', requireRole(['admin', 'ops', 'cs']));

// P0-A 红线监控
adminRoutes.get('/ai/redline/overview', async (c) => {
  const days = c.req.query('range_days') ? parseInt(c.req.query('range_days')!, 10) : 7;
  const data = await getAiRedlineOverview(aiCtx(), { rangeDays: days });
  return c.json({ data });
});

const RedlineListQuery = z.object({
  flag: z.string().max(40).optional(),
  action: z.enum(['block', 'rewrite', 'warn', 'pass']).optional(),
  therapist_user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminRoutes.get('/ai/redline/logs', zValidator('query', RedlineListQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listAiRedlineLogs(aiCtx(), {
    flag: q.flag,
    action: q.action,
    therapistUserId: q.therapist_user_id,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: rows });
});

// P0-B 成本看板
adminRoutes.get('/ai/cost/overview', async (c) => {
  const days = c.req.query('range_days') ? parseInt(c.req.query('range_days')!, 10) : 7;
  const data = await getAiCostOverview(aiCtx(), { rangeDays: days });
  return c.json({ data });
});

// P1-A 代发审计
const AiMsgQuery = z.object({
  therapist_user_id: z.string().uuid().optional(),
  scenario: z.string().max(40).optional(),
  has_redline: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminRoutes.get('/ai/messages', zValidator('query', AiMsgQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listAiMessages(aiCtx(), {
    therapistUserId: q.therapist_user_id,
    scenario: q.scenario,
    hasRedline: q.has_redline,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: rows });
});

// P1-B 客户画像
adminRoutes.get('/ai/assistant-profiles/overview', async (c) => {
  const data = await getAiAssistantProfilesOverview(aiCtx());
  return c.json({ data });
});

adminRoutes.get('/ai/assistant-profiles/:customerId', async (c) => {
  const data = await getAiAssistantProfileDetail(aiCtx(), c.req.param('customerId'));
  return c.json({ data });
});

// M03 · 单客户 L1-L5 全量记忆详情
adminRoutes.get('/ai/assistant-profiles/:customerId/memory-detail', async (c) => {
  const data = await getAiAssistantMemoryDetail(aiCtx(), c.req.param('customerId'));
  return c.json({ data });
});

// M03 · 主动 push + 沉默召回 KPI
adminRoutes.get('/ai/outreach/overview', async (c) => {
  const data = await getAiOutreachOverview(aiCtx());
  return c.json({ data });
});
adminRoutes.use('/audit/*', requireRole(['admin', 'auditor']));
adminRoutes.use('/risk/*', requireRole(['admin', 'ops']));
// 真人核验队列(技师 KYC):admin / auditor 可裁决
adminRoutes.use('/therapists/verifications', requireRole(['admin', 'auditor']));
adminRoutes.use('/therapists/:userId/verify', requireRole(['admin', 'auditor']));

// ──────────────── 真人核验队列 ────────────────

const VerifyQueueQuery = z.object({
  status: z.enum(['pending', 'in_review', 'passed', 'failed', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminRoutes.get('/therapists/verifications', zValidator('query', VerifyQueueQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listVerificationQueue(modCtx(), {
    status: q.status,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: rows });
});

const VerifyDecisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

adminRoutes.post('/therapists/:userId/verify', zValidator('json', VerifyDecisionBody), async (c) => {
  const body = c.req.valid('json');
  const result = await decideVerification(modCtx(), {
    therapistUserId: c.req.param('userId'),
    decision: body.decision,
    auditorUserId: c.get('userId') as string,
    reason: body.reason,
  });
  return c.json({ data: result });
});

// ──────────────── 审核 ────────────────

const QueueQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  target_type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminRoutes.get('/audit/queue', zValidator('query', QueueQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listAuditQueue(modCtx(), {
    status: q.status,
    targetType: q.target_type,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: rows });
});

adminRoutes.post('/audit/:id/approve', async (c) => {
  const row = await approveAudit(modCtx(), {
    auditId: c.req.param('id'),
    auditorUserId: c.get('userId') as string,
  });
  return c.json({ data: row });
});

const RejectBody = z.object({
  reason: z.string().min(1).max(500),
  category: z.string().max(40).optional(),
});

adminRoutes.post('/audit/:id/reject', zValidator('json', RejectBody), async (c) => {
  const body = c.req.valid('json');
  const row = await rejectAudit(modCtx(), {
    auditId: c.req.param('id'),
    auditorUserId: c.get('userId') as string,
    reason: body.reason,
    category: body.category,
  });
  return c.json({ data: row });
});

// ──────────────── 风控 ────────────────

const RiskQuery = z.object({
  subject_user_id: z.string().uuid().optional(),
  event_type: z.string().optional(),
  unresolved_only: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminRoutes.get('/risk/events', zValidator('query', RiskQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listRiskEvents(riskCtx(), {
    subjectUserId: q.subject_user_id,
    eventType: q.event_type,
    unresolvedOnly: q.unresolved_only,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: rows });
});

const ResolveBody = z.object({
  resolution: z.enum(['dismiss', 'warn', 'suspend', 'ban']),
});

adminRoutes.post('/risk/events/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const row = await resolveRiskEvent(riskCtx(), {
    eventId: c.req.param('id'),
    adminUserId: c.get('userId') as string,
    resolution: body.resolution,
  });
  return c.json({ data: row });
});

const BlacklistBody = z.object({
  ip: z.string().min(7).max(45),
  reason: z.string().min(1).max(200),
  severity: z.number().int().min(0).max(100).optional(),
  expires_at: z.string().datetime().optional(),
});

adminRoutes.post('/risk/blacklist', zValidator('json', BlacklistBody), async (c) => {
  const body = c.req.valid('json');
  await addIpToBlacklist(riskCtx(), {
    ip: body.ip,
    reason: body.reason,
    severity: body.severity,
    expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
    addedByUserId: c.get('userId') as string,
  });
  return c.json({ data: { ok: true } });
});

adminRoutes.post('/risk/price-guard/:therapistId/evaluate', async (c) => {
  const result = await evaluatePriceGuard(riskCtx(), c.req.param('therapistId'));
  return c.json({ data: result });
});
