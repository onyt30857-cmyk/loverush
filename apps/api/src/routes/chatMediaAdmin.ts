/**
 * M18 撩拨发图 · Phase 3 · 技师聊天素材库自助 CRUD
 *
 * 技师自管 chat_media（专为聊天撩拨准备的图，分级、不挂公开主页）：
 *   GET    /chat-media/me        列我的全部素材（含停用）
 *   POST   /chat-media/me        新增一张（默认 free）
 *   PATCH  /chat-media/me/:id    改 tier/价/亲密度门槛/权重/启停
 *   DELETE /chat-media/me/:id    删一张
 *
 * 窄 select（不用 db.query.findFirst）· 一切 where 都带 therapistUserId=自己防越权。
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { chatMedia } from '@loverush/db';
import { getDb } from '../db';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

export const chatMediaAdminRoutes = new Hono();
chatMediaAdminRoutes.use('*', requireAuth);

// --- GET /me · 列我的全部素材 ---
chatMediaAdminRoutes.get('/me', async (c) => {
  const uid = c.get('userId');
  const rows = await getDb()
    .select({
      id: chatMedia.id,
      url: chatMedia.url,
      thumbnailUrl: chatMedia.thumbnailUrl,
      tier: chatMedia.tier,
      pricePoints: chatMedia.pricePoints,
      intimacyMin: chatMedia.intimacyMin,
      weight: chatMedia.weight,
      isActive: chatMedia.isActive,
    })
    .from(chatMedia)
    .where(eq(chatMedia.therapistUserId, uid))
    .orderBy(desc(chatMedia.createdAt));
  return c.json({ data: rows });
});

// --- POST /me · 新增一张 ---
const CreateBody = z.object({
  url: z.string().url(),
  thumbnail_url: z.string().url().optional(),
  tier: z.enum(['free', 'paid']).default('free'),
  price_points: z.number().int().min(0).default(0),
  intimacy_min: z.number().int().min(0).max(4).default(0),
  weight: z.number().int().min(1).max(100).default(1),
});

chatMediaAdminRoutes.post('/me', zValidator('json', CreateBody), async (c) => {
  const uid = c.get('userId');
  const b = c.req.valid('json');
  const [row] = await getDb()
    .insert(chatMedia)
    .values({
      therapistUserId: uid,
      url: b.url,
      thumbnailUrl: b.thumbnail_url,
      tier: b.tier,
      pricePoints: b.price_points,
      intimacyMin: b.intimacy_min,
      weight: b.weight,
    })
    .returning({ id: chatMedia.id });
  return c.json({ data: { id: row!.id } });
});

// --- PATCH /me/:id · 改字段 ---
const PatchBody = z.object({
  url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  tier: z.enum(['free', 'paid']).optional(),
  price_points: z.number().int().min(0).optional(),
  intimacy_min: z.number().int().min(0).max(4).optional(),
  weight: z.number().int().min(1).max(100).optional(),
  is_active: z.union([z.literal(0), z.literal(1)]).optional(),
});

chatMediaAdminRoutes.patch('/me/:id', zValidator('json', PatchBody), async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const b = c.req.valid('json');
  // 只 set 提供的字段
  const patch: Partial<typeof chatMedia.$inferInsert> = {};
  if (b.url !== undefined) patch.url = b.url;
  if (b.thumbnail_url !== undefined) patch.thumbnailUrl = b.thumbnail_url;
  if (b.tier !== undefined) patch.tier = b.tier;
  if (b.price_points !== undefined) patch.pricePoints = b.price_points;
  if (b.intimacy_min !== undefined) patch.intimacyMin = b.intimacy_min;
  if (b.weight !== undefined) patch.weight = b.weight;
  if (b.is_active !== undefined) patch.isActive = b.is_active;

  const updated = await getDb()
    .update(chatMedia)
    .set(patch)
    .where(and(eq(chatMedia.id, id), eq(chatMedia.therapistUserId, uid)))
    .returning({ id: chatMedia.id });
  if (updated.length === 0) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'not found');
  }
  return c.json({ data: { id: updated[0]!.id } });
});

// --- DELETE /me/:id · 删一张 ---
chatMediaAdminRoutes.delete('/me/:id', async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  await getDb()
    .delete(chatMedia)
    .where(and(eq(chatMedia.id, id), eq(chatMedia.therapistUserId, uid)));
  return c.json({ data: { ok: true } });
});
