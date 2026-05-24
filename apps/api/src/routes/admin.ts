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
  listAuditQueue,
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

function modCtx(): ModerationContext {
  return { db: getDb() };
}
function riskCtx(): RiskContext {
  return { db: getDb() };
}

export const adminRoutes = new Hono();
adminRoutes.use('*', requireAuth);
// 审核工单需要 admin 或 auditor 角色
// 风控事件 + 黑名单需要 admin 或 ops（运营）角色
adminRoutes.use('/audit/*', requireRole(['admin', 'auditor']));
adminRoutes.use('/risk/*', requireRole(['admin', 'ops']));

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
