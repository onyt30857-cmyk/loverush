/**
 * M02b/M04 Phase 1 · 节目路由 routes
 *
 * 公开:
 *   GET    /shows              客户拉公开节目流
 *   GET    /shows/:id          单条详情(可登可不登)
 *
 * 技师(需 auth):
 *   POST   /shows              发布节目(默认 draft)
 *   GET    /shows/me           我的节目列表
 *   GET    /shows/me/:id       我的节目详情
 *   PUT    /shows/me/:id       更新(状态机 + 字段限制)
 *   DELETE /shows/me/:id       仅 draft 可删
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  createShow,
  listMyShows,
  getShow,
  updateShow,
  deleteShow,
  listOpenShows,
  type ShowContext,
} from '../services/shows';

function ctx(): ShowContext {
  return { db: getDb() };
}

const AddOnsSchema = z
  .array(
    z.object({
      name: z.string().min(1).max(40),
      pricePoints: z.number().int().min(0).max(99999),
      isDefault: z.boolean().optional(),
    }),
  )
  .max(20);

const CreateBody = z.object({
  category_code: z.string().min(2).max(40),
  start_time: z.string().datetime(),
  duration_min: z.number().int().min(60).max(180),
  price_points: z.number().int().min(1).max(99999),
  slots_total: z.number().int().min(1).max(10).optional(),
  add_ons: AddOnsSchema.optional(),
  includes_note: z.string().max(500).optional(),
  excludes_note: z.string().max(500).optional(),
  service_city: z.string().max(40).optional(),
  service_area: z.string().max(80).optional(),
});

const UpdateBody = z.object({
  category_code: z.string().min(2).max(40).optional(),
  start_time: z.string().datetime().optional(),
  duration_min: z.number().int().min(60).max(180).optional(),
  price_points: z.number().int().min(1).max(99999).optional(),
  slots_total: z.number().int().min(1).max(10).optional(),
  add_ons: AddOnsSchema.optional(),
  includes_note: z.string().max(500).optional(),
  excludes_note: z.string().max(500).optional(),
  service_city: z.string().max(40).optional(),
  service_area: z.string().max(80).optional(),
  status: z.enum(['draft', 'open', 'closed']).optional(),
});

const ListQuery = z.object({
  category: z.string().max(40).optional(),
  city: z.string().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ──────────────── 公开路由(不需 auth) ────────────────
export const publicShowRoutes = new Hono();

publicShowRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listOpenShows(ctx(), {
    categoryCode: q.category,
    city: q.city,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    limit: q.limit,
  });
  return c.json({ data: rows });
});

publicShowRoutes.get('/:id', async (c) => {
  const row = await getShow(ctx(), c.req.param('id'));
  return c.json({ data: row });
});

// ──────────────── 技师路由(需 auth) ────────────────
export const myShowRoutes = new Hono();
myShowRoutes.use('*', requireAuth);

myShowRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const row = await createShow(ctx(), c.get('userId') as string, {
    categoryCode: body.category_code,
    startTime: new Date(body.start_time),
    durationMin: body.duration_min,
    pricePoints: body.price_points,
    slotsTotal: body.slots_total,
    addOns: body.add_ons,
    includesNote: body.includes_note,
    excludesNote: body.excludes_note,
    serviceCity: body.service_city,
    serviceArea: body.service_area,
  });
  return c.json({ data: row });
});

const MyListQuery = z.object({
  status: z.enum(['draft', 'open', 'closed', 'completed']).optional(),
});

myShowRoutes.get('/', zValidator('query', MyListQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await listMyShows(ctx(), c.get('userId') as string, { status: q.status });
  return c.json({ data: rows });
});

myShowRoutes.get('/:id', async (c) => {
  const row = await getShow(ctx(), c.req.param('id'));
  // 校验是自己的(getShow 已 join · 用 raw row check 即可)
  if ((row as { therapist_user_id?: string }).therapist_user_id !== (c.get('userId') as string)) {
    return c.json({ error: { code: 'E0001', message: 'not your show' } }, 403);
  }
  return c.json({ data: row });
});

myShowRoutes.put('/:id', zValidator('json', UpdateBody), async (c) => {
  const body = c.req.valid('json');
  const row = await updateShow(ctx(), c.get('userId') as string, c.req.param('id'), {
    categoryCode: body.category_code,
    startTime: body.start_time ? new Date(body.start_time) : undefined,
    durationMin: body.duration_min,
    pricePoints: body.price_points,
    slotsTotal: body.slots_total,
    addOns: body.add_ons,
    includesNote: body.includes_note,
    excludesNote: body.excludes_note,
    serviceCity: body.service_city,
    serviceArea: body.service_area,
    status: body.status,
  });
  return c.json({ data: row });
});

myShowRoutes.delete('/:id', async (c) => {
  await deleteShow(ctx(), c.get('userId') as string, c.req.param('id'));
  return c.json({ data: { ok: true } });
});
