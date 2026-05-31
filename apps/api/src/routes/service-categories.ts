/**
 * M02b/M04 Phase 1 · 服务类型字典 routes
 *
 * 公开 GET(技师/客户都读) · Admin 写
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type CategoryContext,
} from '../services/service-categories';

function ctx(): CategoryContext {
  return { db: getDb() };
}

// ──────────────── 公开 ────────────────
export const publicCategoryRoutes = new Hono();

publicCategoryRoutes.get('/', async (c) => {
  const activeOnly = c.req.query('active_only') !== 'false';
  const rows = await listCategories(ctx(), { activeOnly });
  return c.json({ data: rows });
});

// ──────────────── Admin ────────────────
// 注意:挂载点应在 admin.ts 路由组下 · 自带 admin 权限
const CreateBody = z.object({
  code: z.string().min(2).max(40),
  name_zh: z.string().min(1).max(40),
  name_en: z.string().min(1).max(40),
  description: z.string().max(200).optional(),
  icon_emoji: z.string().max(8).optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
});

const UpdateBody = z.object({
  name_zh: z.string().min(1).max(40).optional(),
  name_en: z.string().min(1).max(40).optional(),
  description: z.string().max(200).optional(),
  icon_emoji: z.string().max(8).optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const adminCategoryRoutes = new Hono();
adminCategoryRoutes.use('*', requireAuth);
adminCategoryRoutes.use('*', requireRole(['admin', 'ops']));

adminCategoryRoutes.get('/', async (c) => {
  const rows = await listCategories(ctx(), { activeOnly: false });
  return c.json({ data: rows });
});

adminCategoryRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const row = await createCategory(ctx(), {
    code: body.code,
    nameZh: body.name_zh,
    nameEn: body.name_en,
    description: body.description,
    iconEmoji: body.icon_emoji,
    displayOrder: body.display_order,
  });
  return c.json({ data: row });
});

adminCategoryRoutes.put('/:id', zValidator('json', UpdateBody), async (c) => {
  const body = c.req.valid('json');
  const row = await updateCategory(ctx(), c.req.param('id'), {
    nameZh: body.name_zh,
    nameEn: body.name_en,
    description: body.description,
    iconEmoji: body.icon_emoji,
    displayOrder: body.display_order,
    isActive: body.is_active,
  });
  return c.json({ data: row });
});

adminCategoryRoutes.delete('/:id', async (c) => {
  await deleteCategory(ctx(), c.req.param('id'));
  return c.json({ data: { ok: true } });
});
