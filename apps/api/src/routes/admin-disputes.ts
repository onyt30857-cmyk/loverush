/**
 * Admin · 心动金仲裁 · 0027 模型
 *
 * GET  /admin/disputes              列出待仲裁(deposit_status=HOLDING)
 * POST /admin/disputes/:id/resolve  admin 仲裁 release/forfeit/refund
 *
 * 仅 admin/cs 角色
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { recordAudit } from '../services/audit';
import { adminResolveDispute, listPendingDisputes } from '../services/deposits';

export const adminDisputesRoutes = new Hono();
adminDisputesRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

adminDisputesRoutes.get('/', async (c) => {
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
  const rows = await listPendingDisputes({ db: getDb() }, { limit });
  return c.json({ data: rows });
});

const ResolveBody = z.object({
  resolution: z.enum(['release', 'forfeit', 'refund']),
  note: z.string().min(1).max(500),
});

adminDisputesRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const depositId = c.req.param('id');
  await adminResolveDispute({ db: getDb() }, depositId, body.resolution);
  await recordAudit({ db: getDb() }, c, {
    action: 'deposit.admin_resolve',
    targetType: 'deposit',
    targetId: depositId,
    after: { resolution: body.resolution },
    reason: body.note,
    actorRole: 'cs',
  });
  return c.json({ data: { ok: true } });
});
