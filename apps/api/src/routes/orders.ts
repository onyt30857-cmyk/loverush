/**
 * 订单路由 · M07
 *
 * POST   /orders                            创建草稿订单（客户）
 * POST   /orders/:id/submit                 提交确认（客户）
 * POST   /orders/:id/confirm                技师确认 + 锁价
 * POST   /orders/:id/pay                    客户支付完成回调
 * POST   /orders/:id/start                  技师开始服务
 * POST   /orders/:id/complete               技师标记完成
 * POST   /orders/:id/review                 客户评价
 * POST   /orders/:id/cancel                 任一方取消
 * POST   /orders/:id/dispute                提起争议
 * POST   /admin/orders/:id/resolve          仲裁裁决
 * GET    /orders/:id                        查询订单
 * GET    /orders/:id/chain                  查询凭证链
 * GET    /orders/:id/chain/verify           验证凭证链完整性
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { orderChain, orders } from '@loverush/db';
import { getDb } from '../db';
import { requireAuth } from '../middleware/auth';
import { verifyChain } from '../services/chain';
import {
  cancelOrder,
  completeService,
  confirmAndLock,
  createOrder,
  listOrders,
  markPaid,
  raiseDispute,
  resolveDispute,
  reviewOrder,
  startService,
  submitOrder,
  adminListOrders,
  adminGetOrder,
  type OrderContext,
} from '../services/orders';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

function ctx(): OrderContext {
  return { db: getDb() };
}

const CreateBody = z.object({
  therapist_id: z.string().uuid(),
  service_snapshot: z.object({
    skills: z.array(z.string()),
    durationMin: z.number().int().positive(),
    pricePoints: z.number().int().nonnegative(),
    itemsBreakdown: z
      .array(z.object({ name: z.string(), pricePoints: z.number().int() }))
      .optional(),
  }),
  scheduled_at: z.string().datetime().optional(),
});

const ReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(500).optional(),
});

const CancelBody = z.object({ reason: z.string().min(1).max(200) });
const DisputeBody = z.object({ reason: z.string().min(1).max(500) });
const PayBody = z.object({ payment_txn_id: z.string().min(1) });
const ResolveBody = z.object({
  resolution: z.enum(['refund', 'reject']),
  refund_points: z.number().int().nonnegative().optional(),
  note: z.string().max(500).optional(),
});

export const orderRoutes = new Hono();

orderRoutes.use('*', requireAuth);

orderRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const role = (c.req.query('role') === 'therapist' ? 'therapist' : 'customer');
  const statusParam = c.req.query('status');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;

  const ALLOWED = ['DRAFT', 'PENDING_CONFIRM', 'LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'CLOSED'] as const;
  type Status = (typeof ALLOWED)[number];
  let status: Status | Status[] | undefined;
  if (statusParam) {
    const parts = statusParam.split(',').map((s) => s.trim()).filter((s): s is Status => (ALLOWED as readonly string[]).includes(s));
    if (parts.length === 1) status = parts[0];
    else if (parts.length > 1) status = parts;
  }

  const rows = await listOrders(ctx(), { userId, role, status, limit, offset });
  return c.json({ data: rows });
});

orderRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const order = await createOrder(ctx(), {
    customerId: userId,
    therapistId: body.therapist_id,
    serviceSnapshot: body.service_snapshot,
    scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
  });
  return c.json({ data: order });
});

orderRoutes.post('/:id/submit', async (c) => {
  const order = await submitOrder(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/confirm', async (c) => {
  const order = await confirmAndLock(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/pay', zValidator('json', PayBody), async (c) => {
  const body = c.req.valid('json');
  const order = await markPaid(ctx(), c.req.param('id'), body.payment_txn_id, c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/start', async (c) => {
  const order = await startService(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/complete', async (c) => {
  const order = await completeService(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/review', zValidator('json', ReviewBody), async (c) => {
  const body = c.req.valid('json');
  const order = await reviewOrder(ctx(), c.req.param('id'), c.get('userId'), {
    rating: body.rating,
    review: body.review,
  });
  return c.json({ data: order });
});

orderRoutes.post('/:id/cancel', zValidator('json', CancelBody), async (c) => {
  const body = c.req.valid('json');
  const order = await cancelOrder(ctx(), c.req.param('id'), c.get('userId'), body.reason);
  return c.json({ data: order });
});

orderRoutes.post('/:id/dispute', zValidator('json', DisputeBody), async (c) => {
  const body = c.req.valid('json');
  const order = await raiseDispute(ctx(), c.req.param('id'), c.get('userId'), body.reason);
  return c.json({ data: order });
});

orderRoutes.get('/:id', async (c) => {
  const order = await getDb().query.orders.findFirst({ where: eq(orders.id, c.req.param('id')) });
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  return c.json({ data: order });
});

orderRoutes.get('/:id/chain', async (c) => {
  const list = await getDb().query.orderChain.findMany({
    where: eq(orderChain.orderId, c.req.param('id')),
    orderBy: [asc(orderChain.seq)],
  });
  return c.json({ data: list });
});

orderRoutes.get('/:id/chain/verify', async (c) => {
  const result = await verifyChain(getDb(), c.req.param('id'));
  return c.json({ data: result });
});

// Admin · 仲裁裁决（仅 admin 或 cs 客服可裁决）
import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';

export const adminOrderRoutes = new Hono();
adminOrderRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

const AdminListQuery = z.object({
  status: z
    .enum(['DRAFT', 'PENDING_CONFIRM', 'LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'CLOSED'])
    .optional(),
  search: z.string().max(60).optional(),
  customer_id: z.string().uuid().optional(),
  therapist_user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminOrderRoutes.get('/', zValidator('query', AdminListQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await adminListOrders(ctx(), {
    status: q.status,
    search: q.search,
    customerId: q.customer_id,
    therapistUserId: q.therapist_user_id,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: list });
});

adminOrderRoutes.get('/:id', async (c) => {
  const order = await adminGetOrder(ctx(), c.req.param('id'));
  if (!order) {
    return c.json({ error: { code: 'E0003', message: 'order not found', timestamp: new Date().toISOString() } }, 404);
  }
  return c.json({ data: order });
});

adminOrderRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const order = await resolveDispute(ctx(), c.req.param('id'), c.get('userId'), {
    resolution: body.resolution,
    refundPoints: body.refund_points,
    note: body.note,
  });
  await recordAudit(ctx(), c, {
    action: 'order.resolve_dispute',
    targetType: 'order',
    targetId: c.req.param('id'),
    after: {
      status: order.status,
      resolution: body.resolution,
      refundPoints: body.refund_points ?? 0,
    },
    reason: body.note,
    actorRole: 'cs',
  });
  return c.json({ data: order });
});
