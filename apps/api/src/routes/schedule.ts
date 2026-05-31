/**
 * M07 · 技师排班路由
 *
 * 公开:
 *   GET    /therapists/:userId/availability?date=YYYY-MM-DD&duration=60
 *
 * 技师自己:
 *   GET    /therapists/me/schedule                · 拉 7 天 working_hours
 *   PUT    /therapists/me/schedule                · 批量更新 7 天
 *   POST   /therapists/me/unavailable             · 临时挡时段
 *   GET    /therapists/me/unavailable             · 拉本人未来 unavail 列表
 *   DELETE /therapists/me/unavailable/:id         · 撤销 unavail
 *   PUT    /therapists/me/schedule/config         · 改 slot_minutes / buffer_minutes
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, gte } from 'drizzle-orm';
import {
  therapists,
  therapistWorkingHours,
  therapistUnavailablePeriod,
} from '@loverush/db';
import { getDb } from '../db';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { computeAvailability } from '../services/availability';

// ──────────────── PUBLIC · 客户查可约时段 ────────────────

export const therapistAvailabilityRoutes = new Hono();

const AvailabilityQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date 必须 YYYY-MM-DD'),
  duration: z.coerce.number().int().min(15).max(480).optional(),
});

therapistAvailabilityRoutes.get('/:userId/availability', zValidator('query', AvailabilityQuery), async (c) => {
  const therapistUserId = c.req.param('userId');
  const q = c.req.valid('query');
  const slots = await computeAvailability(getDb(), {
    therapistUserId,
    date: q.date,
    durationMinutes: q.duration,
  });
  c.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  return c.json({ data: { slots } });
});

// ──────────────── 技师自己 · 排班管理 ────────────────

export const therapistScheduleRoutes = new Hono();
therapistScheduleRoutes.use('*', requireAuth);

// --- GET /therapists/me/schedule ---
therapistScheduleRoutes.get('/me/schedule', async (c) => {
  const userId = c.get('userId');
  const rows = await getDb().query.therapistWorkingHours.findMany({
    where: eq(therapistWorkingHours.therapistUserId, userId),
  });
  const t = await getDb().query.therapists.findFirst({
    where: eq(therapists.userId, userId),
    columns: { slotMinutes: true, bufferMinutes: true },
  });
  return c.json({
    data: {
      working_hours: rows
        .map((r) => ({
          weekday: r.weekday,
          start_time: r.startTime,
          end_time: r.endTime,
          is_active: r.isActive,
        }))
        .sort((a, b) => a.weekday - b.weekday),
      slot_minutes: t?.slotMinutes ?? 30,
      buffer_minutes: t?.bufferMinutes ?? 15,
    },
  });
});

// --- PUT /therapists/me/schedule (batch) ---
const ScheduleItem = z.object({
  weekday: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  is_active: z.boolean().optional().default(true),
});
const ScheduleBatchBody = z.object({
  working_hours: z.array(ScheduleItem).max(7),
});

therapistScheduleRoutes.put('/me/schedule', zValidator('json', ScheduleBatchBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const db = getDb();

  // upsert · 每 weekday 一行
  for (const item of body.working_hours) {
    if (item.start_time >= item.end_time) {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'start_time must < end_time');
    }
    // normalize HH:MM → HH:MM:00
    const st = item.start_time.length === 5 ? `${item.start_time}:00` : item.start_time;
    const et = item.end_time.length === 5 ? `${item.end_time}:00` : item.end_time;

    const existing = await db.query.therapistWorkingHours.findFirst({
      where: and(
        eq(therapistWorkingHours.therapistUserId, userId),
        eq(therapistWorkingHours.weekday, item.weekday),
      ),
    });
    if (existing) {
      await db
        .update(therapistWorkingHours)
        .set({
          startTime: st,
          endTime: et,
          isActive: item.is_active,
          updatedAt: new Date(),
        })
        .where(eq(therapistWorkingHours.id, existing.id));
    } else {
      await db.insert(therapistWorkingHours).values({
        therapistUserId: userId,
        weekday: item.weekday,
        startTime: st,
        endTime: et,
        isActive: item.is_active,
      });
    }
  }

  return c.json({ data: { ok: true, count: body.working_hours.length } });
});

// --- PUT /therapists/me/schedule/config (slot + buffer) ---
const ConfigBody = z.object({
  slot_minutes: z.number().int().min(15).max(120).optional(),
  buffer_minutes: z.number().int().min(0).max(120).optional(),
});
therapistScheduleRoutes.put('/me/schedule/config', zValidator('json', ConfigBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const patch: Record<string, number> = {};
  if (body.slot_minutes !== undefined) patch.slotMinutes = body.slot_minutes;
  if (body.buffer_minutes !== undefined) patch.bufferMinutes = body.buffer_minutes;
  if (Object.keys(patch).length === 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'nothing to update');
  }
  await getDb()
    .update(therapists)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(therapists.userId, userId));
  return c.json({ data: { ok: true } });
});

// --- GET /therapists/me/unavailable ---
therapistScheduleRoutes.get('/me/unavailable', async (c) => {
  const userId = c.get('userId');
  const rows = await getDb()
    .select()
    .from(therapistUnavailablePeriod)
    .where(
      and(
        eq(therapistUnavailablePeriod.therapistUserId, userId),
        gte(therapistUnavailablePeriod.endAt, new Date()),
      ),
    );
  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      start_at: r.startAt,
      end_at: r.endAt,
      reason: r.reason,
    })),
  });
});

// --- POST /therapists/me/unavailable ---
const UnavailBody = z.object({
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  reason: z.string().max(100).optional(),
});

therapistScheduleRoutes.post('/me/unavailable', zValidator('json', UnavailBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const startAt = new Date(body.start_at);
  const endAt = new Date(body.end_at);
  if (startAt >= endAt) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'start_at must < end_at');
  }
  if (endAt.getTime() < Date.now()) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'end_at in past');
  }
  const [row] = await getDb()
    .insert(therapistUnavailablePeriod)
    .values({
      therapistUserId: userId,
      startAt,
      endAt,
      reason: body.reason ?? null,
    })
    .returning();
  return c.json({ data: { id: row?.id, start_at: row?.startAt, end_at: row?.endAt } });
});

// --- DELETE /therapists/me/unavailable/:id ---
therapistScheduleRoutes.delete('/me/unavailable/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const existing = await getDb().query.therapistUnavailablePeriod.findFirst({
    where: eq(therapistUnavailablePeriod.id, id),
  });
  if (!existing) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'not found');
  if (existing.therapistUserId !== userId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not yours');
  }
  await getDb()
    .delete(therapistUnavailablePeriod)
    .where(eq(therapistUnavailablePeriod.id, id));
  return c.json({ data: { ok: true } });
});
