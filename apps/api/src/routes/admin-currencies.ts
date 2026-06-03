/**
 * Admin · 法币字典 + 汇率维护 · 0027 模型
 *
 * GET    /admin/currencies            列字典(全 · 含 inactive)
 * POST   /admin/currencies            新增
 * PUT    /admin/currencies/:code      改
 * DELETE /admin/currencies/:code      软删(isActive=0)
 *
 * GET    /admin/exchange-rates        列汇率(按 currency 分组 · 最新+历史)
 * POST   /admin/exchange-rates        新建一条生效(effective_at=now)
 *
 * 仅 admin/finance 角色
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { currencies, exchangeRates } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { recordAudit } from '../services/audit';
import { clearFxCache } from '../services/fx';

export const adminCurrenciesRoutes = new Hono();
adminCurrenciesRoutes.use('*', requireAuth, requireRole(['admin', 'finance']));

// ──────────────── currencies CRUD ────────────────

adminCurrenciesRoutes.get('/', async (c) => {
  const rows = await getDb().query.currencies.findMany({
    orderBy: [currencies.displayOrder, currencies.code],
  });
  return c.json({ data: rows });
});

const CreateBody = z.object({
  code: z.string().min(2).max(8).regex(/^[A-Z]+$/, 'ISO 4217 大写'),
  symbol: z.string().min(1).max(4),
  name_zh: z.string().min(1).max(40),
  name_en: z.string().min(1).max(40),
  decimals: z.number().int().min(0).max(4).optional(),
  display_order: z.number().int().min(0).max(999).optional(),
});

adminCurrenciesRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const [row] = await getDb()
    .insert(currencies)
    .values({
      code: body.code,
      symbol: body.symbol,
      nameZh: body.name_zh,
      nameEn: body.name_en,
      decimals: body.decimals ?? 2,
      displayOrder: body.display_order ?? 100,
    })
    .returning();
  void recordAudit({ db: getDb() }, c, {
    action: 'currency.create',
    targetType: 'currency',
    targetId: body.code,
    after: body as Record<string, unknown>,
  });
  clearFxCache();
  return c.json({ data: row });
});

const UpdateBody = z.object({
  symbol: z.string().min(1).max(4).optional(),
  name_zh: z.string().min(1).max(40).optional(),
  name_en: z.string().min(1).max(40).optional(),
  decimals: z.number().int().min(0).max(4).optional(),
  display_order: z.number().int().min(0).max(999).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

adminCurrenciesRoutes.put('/:code', zValidator('json', UpdateBody), async (c) => {
  const code = c.req.param('code').toUpperCase();
  const body = c.req.valid('json');
  const patch: Partial<typeof currencies.$inferInsert> = {};
  if (body.symbol !== undefined) patch.symbol = body.symbol;
  if (body.name_zh !== undefined) patch.nameZh = body.name_zh;
  if (body.name_en !== undefined) patch.nameEn = body.name_en;
  if (body.decimals !== undefined) patch.decimals = body.decimals;
  if (body.display_order !== undefined) patch.displayOrder = body.display_order;
  if (body.is_active !== undefined) patch.isActive = body.is_active;

  const [row] = await getDb()
    .update(currencies)
    .set(patch)
    .where(eq(currencies.code, code))
    .returning();
  void recordAudit({ db: getDb() }, c, {
    action: 'currency.update',
    targetType: 'currency',
    targetId: code,
    after: body as Record<string, unknown>,
  });
  clearFxCache();
  return c.json({ data: row });
});

adminCurrenciesRoutes.delete('/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  // 软删:isActive=0
  await getDb()
    .update(currencies)
    .set({ isActive: 0 })
    .where(eq(currencies.code, code));
  void recordAudit({ db: getDb() }, c, {
    action: 'currency.disable',
    targetType: 'currency',
    targetId: code,
  });
  clearFxCache();
  return c.json({ data: { ok: true } });
});

// ──────────────── exchange-rates ────────────────

export const adminExchangeRatesRoutes = new Hono();
adminExchangeRatesRoutes.use('*', requireAuth, requireRole(['admin', 'finance']));

/** 列汇率 · 按 currency 分组 · 默认拉每个 currency 最新一条 + 该 currency 的历史 list */
adminExchangeRatesRoutes.get('/', async (c) => {
  const rows = await getDb().query.exchangeRates.findMany({
    orderBy: [desc(exchangeRates.effectiveAt)],
    limit: 500,
  });
  // 按 currency 分组 + 标记最新
  const grouped = new Map<string, Array<{ id: string; pointsPerUnit: string; effectiveAt: Date; isLatest: boolean }>>();
  for (const r of rows) {
    if (!grouped.has(r.currencyCode)) grouped.set(r.currencyCode, []);
    grouped.get(r.currencyCode)!.push({
      id: r.id,
      pointsPerUnit: r.pointsPerUnit,
      effectiveAt: r.effectiveAt,
      isLatest: false,
    });
  }
  // 每组首行标记 isLatest=true(已按 effective_at desc 排过)
  for (const list of grouped.values()) {
    if (list[0]) list[0].isLatest = true;
  }

  return c.json({
    data: Array.from(grouped.entries()).map(([currencyCode, history]) => ({
      currency_code: currencyCode,
      latest: history[0]?.pointsPerUnit ?? null,
      history,
    })),
  });
});

const NewRateBody = z.object({
  currency_code: z.string().min(2).max(8),
  points_per_unit: z.number().positive().max(1_000_000),
  effective_at: z.string().datetime().optional(), // 默认 now
});

adminExchangeRatesRoutes.post('/', zValidator('json', NewRateBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const [row] = await getDb()
    .insert(exchangeRates)
    .values({
      currencyCode: body.currency_code.toUpperCase(),
      pointsPerUnit: String(body.points_per_unit), // numeric 用 string
      effectiveAt: body.effective_at ? new Date(body.effective_at) : new Date(),
      updatedByUserId: userId,
    })
    .returning();
  void recordAudit({ db: getDb() }, c, {
    action: 'exchange_rate.create',
    targetType: 'exchange_rate',
    targetId: row?.id,
    after: body as Record<string, unknown>,
  });
  clearFxCache();
  return c.json({ data: row });
});
