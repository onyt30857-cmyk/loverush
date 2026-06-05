/**
 * 平台收款账户 路由 · M16 批发采购
 * admin /admin/platform-accounts/*  requireRole(['admin','finance'])
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  type PlatformContext,
  listAllPlatformAccounts,
  upsertPlatformAccount,
  deletePlatformAccount,
} from '../services/platform';

function ctx(): PlatformContext {
  return { db: getDb() };
}

export const adminPlatformRoutes = new Hono();
adminPlatformRoutes.use('*', requireAuth, requireRole(['admin', 'finance']));

adminPlatformRoutes.get('/', async (c) => {
  const list = await listAllPlatformAccounts(ctx());
  return c.json({ data: list });
});

const AccountBody = z.object({
  id: z.string().uuid().optional(),
  method_type: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  fields: z.record(z.string()),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
  note: z.string().max(500).optional(),
});
adminPlatformRoutes.put('/', zValidator('json', AccountBody), async (c) => {
  const b = c.req.valid('json');
  const row = await upsertPlatformAccount(ctx(), {
    id: b.id,
    methodType: b.method_type,
    label: b.label,
    fields: b.fields,
    isActive: b.is_active,
    displayOrder: b.display_order,
    note: b.note,
  });
  return c.json({ data: row });
});

adminPlatformRoutes.delete('/:id', async (c) => {
  await deletePlatformAccount(ctx(), c.req.param('id'));
  return c.json({ data: { ok: true } });
});
