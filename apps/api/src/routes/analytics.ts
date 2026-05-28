/**
 * 埋点路由 · M14
 *
 * POST   /events                          客户端 / 服务端通用上报
 * GET    /admin/analytics/daily           按天聚合查询
 * POST   /admin/analytics/aggregate-yesterday   手动触发聚合（cron 替代）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  aggregateYesterday,
  queryDailyAgg,
  track,
  type AnalyticsContext,
} from '../services/analytics';

function ctx(): AnalyticsContext {
  return { db: getDb() };
}

const TrackBody = z.object({
  event_name: z.string().min(1).max(80),
  event_category: z.enum(['ui', 'order', 'payment', 'chat', 'ai', 'risk', 'shop', 'review', 'other']),
  ref_type: z.string().max(40).optional(),
  ref_id: z.string().uuid().optional(),
  properties: z.record(z.unknown()).optional(),
  occurred_at: z.string().datetime().optional(),
});

const DailyQuery = z.object({
  event_name: z.string().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const eventRoutes = new Hono();
eventRoutes.use('*', requireAuth);

eventRoutes.post('/', zValidator('json', TrackBody), async (c) => {
  const body = c.req.valid('json');
  await track(ctx(), {
    eventName: body.event_name,
    eventCategory: body.event_category,
    actorUserId: c.get('userId'),
    refType: body.ref_type,
    refId: body.ref_id,
    properties: body.properties,
    locale: c.get('locale'),
    occurredAt: body.occurred_at ? new Date(body.occurred_at) : undefined,
  });
  return c.json({ data: { ok: true } });
});

import { requireRole } from '../middleware/role';

export const adminAnalyticsRoutes = new Hono();
adminAnalyticsRoutes.use('*', requireAuth, requireRole(['admin', 'ops']));

adminAnalyticsRoutes.get('/daily', zValidator('query', DailyQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await queryDailyAgg(ctx(), {
    eventName: q.event_name,
    fromDate: q.from_date,
    toDate: q.to_date,
  });
  return c.json({ data: list });
});

adminAnalyticsRoutes.post('/aggregate-yesterday', async (c) => {
  const inserted = await aggregateYesterday(ctx());
  return c.json({ data: { inserted } });
});
