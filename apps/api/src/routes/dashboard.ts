/**
 * 看板路由 · M14
 *
 * GET    /dashboard/therapist/me           技师端 KPI
 * GET    /dashboard/customer/me            客户端 KPI
 * GET    /admin/dashboard                  运营大盘
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  adminDashboard,
  customerDashboard,
  therapistDashboard,
  type DashboardContext,
} from '../services/dashboard';

function ctx(): DashboardContext {
  return { db: getDb() };
}

const RangeQuery = z.object({ range_days: z.coerce.number().int().min(1).max(365).optional() });

export const dashboardRoutes = new Hono();
dashboardRoutes.use('*', requireAuth);

dashboardRoutes.get('/therapist/me', zValidator('query', RangeQuery), async (c) => {
  const q = c.req.valid('query');
  const data = await therapistDashboard(ctx(), {
    therapistUserId: c.get('userId') as string,
    rangeDays: q.range_days,
  });
  return c.json({ data });
});

dashboardRoutes.get('/customer/me', zValidator('query', RangeQuery), async (c) => {
  const q = c.req.valid('query');
  const data = await customerDashboard(ctx(), {
    customerId: c.get('userId') as string,
    rangeDays: q.range_days,
  });
  return c.json({ data });
});

import { requireRole } from '../middleware/role';

export const adminDashboardRoutes = new Hono();
adminDashboardRoutes.use('*', requireAuth, requireRole(['admin', 'ops']));

adminDashboardRoutes.get('/', zValidator('query', RangeQuery), async (c) => {
  const q = c.req.valid('query');
  const data = await adminDashboard(ctx(), { rangeDays: q.range_days });
  return c.json({ data });
});
