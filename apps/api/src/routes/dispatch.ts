/**
 * 派单路由 · M04
 *
 * POST   /orders/:id/dispatch        客户发起派单（系统给 Top-K 技师广播）
 * GET    /me/offers                  技师查看待处理 offer
 * POST   /me/offers/:id/accept       技师接受
 * POST   /me/offers/:id/decline      技师拒绝
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { orders } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  acceptDispatch,
  broadcastDispatch,
  declineDispatch,
  listPendingForTherapist,
  type DispatchContext,
} from '../services/dispatch';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

function dctx(): DispatchContext {
  return { db: getDb() };
}

const DispatchBody = z.object({
  fanout: z.number().int().min(1).max(10).optional(),
  city: z.string().max(40).optional(),
});

const DeclineBody = z.object({ reason: z.string().max(200).optional() });

export const customerDispatchRoutes = new Hono();
customerDispatchRoutes.use('*', requireAuth);

// 挂载点已经是 `/orders/:orderId/dispatch`（见 index.ts），sub-route path 是 `/`
customerDispatchRoutes.post('/', zValidator('json', DispatchBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const orderId = c.req.param('orderId') as string;
  const order = await getDb().query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (order.customerId !== userId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your order');
  }
  const offers = await broadcastDispatch(dctx(), { order, fanout: body.fanout, city: body.city });
  return c.json({ data: offers });
});

export const therapistOfferRoutes = new Hono();
therapistOfferRoutes.use('*', requireAuth);

therapistOfferRoutes.get('/', async (c) => {
  const list = await listPendingForTherapist(dctx(), c.get('userId'));
  return c.json({ data: list });
});

therapistOfferRoutes.post('/:id/accept', async (c) => {
  const result = await acceptDispatch(dctx(), {
    offerId: c.req.param('id'),
    therapistUserId: c.get('userId'),
  });
  return c.json({ data: result });
});

therapistOfferRoutes.post('/:id/decline', zValidator('json', DeclineBody), async (c) => {
  const body = c.req.valid('json');
  const row = await declineDispatch(dctx(), {
    offerId: c.req.param('id'),
    therapistUserId: c.get('userId'),
    reason: body.reason,
  });
  return c.json({ data: row });
});
