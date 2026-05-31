/**
 * 系统错误监管 admin routes · 仅 admin/ops/auditor
 *
 * GET   /admin/system-errors                列表(默认未解决 · 按 severity+last_seen 排)
 * GET   /admin/system-errors/active-count   dashboard widget · 24h 高危未解决数
 * GET   /admin/system-errors/risk-login     登录异常列表(代理到 risk_events login_*)
 * POST  /admin/system-errors/:id/resolve    标记已处理
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  countActiveHighSeverity,
  listSystemErrors,
  resolveSystemError,
  type SystemErrorContext,
} from '../services/system_errors';
import { listRiskEvents } from '../services/risk';
import { recordAudit } from '../services/audit';
import { getErrorHint } from '@loverush/types';

function ctx(): SystemErrorContext {
  return { db: getDb() };
}

export const adminSystemErrorsRoutes = new Hono();
adminSystemErrorsRoutes.use('*', requireAuth, requireRole(['admin', 'ops', 'auditor']));

const ListQuery = z.object({
  unresolved_only: z.enum(['true', 'false']).optional(),
  error_type: z.string().optional(),
  min_severity: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

adminSystemErrorsRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listSystemErrors(ctx(), {
    unresolvedOnly: q.unresolved_only !== 'false', // 默认 true
    errorType: q.error_type,
    minSeverity: q.min_severity,
    limit: q.limit ?? 100,
  });
  // 每行附加 hint(自查表)
  const withHints = rows.map((r) => ({
    ...r,
    hint: getErrorHint({
      errorCode: r.errorCode,
      errorType: r.errorType,
      httpStatus: r.httpStatus,
    }),
  }));
  return c.json({ data: withHints });
});

adminSystemErrorsRoutes.get('/active-count', async (c) => {
  const n = await countActiveHighSeverity(ctx(), 70);
  return c.json({ data: { count: n, threshold: 70 } });
});

/** 登录异常列表 · 代理到 risk_events 的 login_* */
adminSystemErrorsRoutes.get('/risk-login', async (c) => {
  const rows = await listRiskEvents({ db: getDb() }, {
    unresolvedOnly: false,
    limit: 100,
  });
  const loginOnly = rows.filter((r) => r.eventType.startsWith('login_'));
  return c.json({ data: loginOnly });
});

const ResolveBody = z.object({
  resolution: z.enum(['fixed', 'wont_fix', 'duplicate', 'external']),
});

adminSystemErrorsRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await resolveSystemError(ctx(), {
    id,
    resolverUserId: userId,
    resolution: body.resolution,
  });
  void recordAudit(ctx(), c, {
    action: 'system_error.resolve',
    targetType: 'system_error',
    targetId: id,
    after: { resolution: body.resolution },
  });
  return c.json({ data: { ok: true } });
});
