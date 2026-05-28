/**
 * 客服仲裁路由 · M12
 *
 * POST   /tickets                          创建工单
 * GET    /tickets/me                       我的工单
 * GET    /tickets/:id                      工单详情 + 沟通历史
 * POST   /tickets/:id/replies              回复工单
 *
 * admin
 * GET    /admin/tickets                    工单队列
 * POST   /admin/tickets/:id/assign         指派
 * POST   /admin/tickets/:id/resolve        裁决
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tickets } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  assign,
  createTicket,
  listAdminQueue,
  listMessages,
  listMyTickets,
  reply,
  resolve,
  type TicketContext,
} from '../services/tickets';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

function tctx(): TicketContext {
  return { db: getDb() };
}

const CreateBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  target_user_id: z.string().uuid().optional(),
  related_order_id: z.string().uuid().optional(),
  evidence: z.record(z.unknown()).optional(),
});

const ReplyBody = z.object({
  content: z.string().min(1).max(2000),
  is_internal: z.boolean().optional(),
});

const AssignBody = z.object({ assignee_user_id: z.string().uuid() });

const ResolveBody = z.object({
  resolution_type: z.enum(['refund', 'warn_target', 'suspend_target', 'ban_target', 'dismiss', 'no_action']),
  resolution_note: z.string().min(1).max(1000),
  refund_points: z.number().int().nonnegative().optional(),
  suspend_days: z.number().int().min(1).max(365).optional(),
});

const QueueQuery = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const MyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const ticketRoutes = new Hono();
ticketRoutes.use('*', requireAuth);

ticketRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const row = await createTicket(tctx(), {
    reporterUserId: c.get('userId'),
    title: body.title,
    description: body.description,
    targetUserId: body.target_user_id,
    relatedOrderId: body.related_order_id,
    evidence: body.evidence,
  });
  return c.json({ data: row });
});

ticketRoutes.get('/me', zValidator('query', MyQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await listMyTickets(tctx(), { userId: c.get('userId'), limit: q.limit, offset: q.offset });
  return c.json({ data: list });
});

ticketRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const t = await getDb().query.tickets.findFirst({ where: eq(tickets.id, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'ticket not found');
  if (t.reporterUserId !== userId && t.targetUserId !== userId && t.assigneeUserId !== userId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not a participant');
  }
  const msgs = await listMessages(tctx(), id);
  return c.json({ data: { ticket: t, messages: msgs.filter((m) => !m.isInternal || t.assigneeUserId === userId) } });
});

ticketRoutes.post('/:id/replies', zValidator('json', ReplyBody), async (c) => {
  const body = c.req.valid('json');
  const id = c.req.param('id');
  const userId = c.get('userId');
  const t = await getDb().query.tickets.findFirst({ where: eq(tickets.id, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'ticket not found');

  let role: 'reporter' | 'target' | 'cs_human' | 'admin';
  if (t.reporterUserId === userId) role = 'reporter';
  else if (t.targetUserId === userId) role = 'target';
  else if (t.assigneeUserId === userId) role = 'cs_human';
  else throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not a participant');

  const msg = await reply(tctx(), {
    ticketId: id,
    senderUserId: userId,
    senderRole: role,
    content: body.content,
    isInternal: body.is_internal && role !== 'reporter' && role !== 'target' ? true : false,
  });
  return c.json({ data: msg });
});

// admin · 客服/管理员
import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';

export const adminTicketRoutes = new Hono();
adminTicketRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

adminTicketRoutes.get('/', zValidator('query', QueueQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await listAdminQueue(tctx(), { status: q.status, category: q.category, limit: q.limit, offset: q.offset });
  return c.json({ data: list });
});

adminTicketRoutes.post('/:id/assign', zValidator('json', AssignBody), async (c) => {
  const body = c.req.valid('json');
  const row = await assign(tctx(), { ticketId: c.req.param('id'), assigneeUserId: body.assignee_user_id });
  await recordAudit(tctx(), c, {
    action: 'ticket.assign',
    targetType: 'ticket',
    targetId: c.req.param('id'),
    after: { assigneeUserId: body.assignee_user_id },
    actorRole: 'cs',
  });
  return c.json({ data: row });
});

adminTicketRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const row = await resolve(tctx(), {
    ticketId: c.req.param('id'),
    adminUserId: c.get('userId'),
    resolutionType: body.resolution_type,
    resolutionNote: body.resolution_note,
    refundPoints: body.refund_points,
    suspendDays: body.suspend_days,
  });
  await recordAudit(tctx(), c, {
    action: 'ticket.resolve',
    targetType: 'ticket',
    targetId: c.req.param('id'),
    after: {
      resolutionType: body.resolution_type,
      refundPoints: body.refund_points ?? 0,
      suspendDays: body.suspend_days ?? 0,
    },
    reason: body.resolution_note,
    actorRole: 'cs',
  });
  return c.json({ data: row });
});
