/**
 * Customer 端 · 心动金历史 · 0027
 *
 * GET /me/deposits  当前用户的所有 deposit 记录(含老订单为 null)
 *   返:depositId / orderId / orderNo / status / amount / createdAt / releasedAt / resolution
 *
 * 仅返客户自己的(customerId = currentUser)· 防隔窗看他人订单
 */

import { Hono } from 'hono';
import { desc, eq, inArray } from 'drizzle-orm';
import { orderDeposits, orders } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';

export const meDepositsRoutes = new Hono();
meDepositsRoutes.use('*', requireAuth);

meDepositsRoutes.get('/', async (c) => {
  const userId = c.get('userId') as string;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
  const status = c.req.query('status'); // 可选 filter

  const db = getDb();

  const deps = await db.query.orderDeposits.findMany({
    where: eq(orderDeposits.customerId, userId),
    orderBy: [desc(orderDeposits.createdAt)],
    limit,
  });
  if (deps.length === 0) return c.json({ data: [] });

  const orderIds = deps.map((d) => d.orderId);
  const orderRows = await db.query.orders.findMany({
    where: inArray(orders.id, orderIds),
  });
  const orderMap = new Map(orderRows.map((o) => [o.id, o]));

  return c.json({
    data: deps
      .filter((d) => !status || d.status === status)
      .map((d) => {
        const o = orderMap.get(d.orderId);
        return {
          depositId: d.id,
          orderId: d.orderId,
          orderNo: o?.orderNo ?? '—',
          status: d.status,
          depositPoints: d.depositPoints,
          currencyCode: o?.currencyCode ?? null,
          totalFiat: o?.totalFiat ?? null,
          orderStatus: o?.status ?? null,
          createdAt: d.createdAt,
          releasedAt: d.releasedAt,
          resolution: d.resolution,
        };
      }),
  });
});
