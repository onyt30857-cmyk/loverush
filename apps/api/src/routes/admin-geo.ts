/**
 * Admin · 地理字典 CRUD · M02 Phase 5
 *
 * 端点(全 requireRole admin/ops · 审计走 recordAudit):
 *   GET    /admin/geo/cities
 *   POST   /admin/geo/cities
 *   PATCH  /admin/geo/cities/:id
 *   DELETE /admin/geo/cities/:id          软删(enabled=0)
 *   GET    /admin/geo/cities/:cityId/areas
 *   POST   /admin/geo/cities/:cityId/areas
 *   PATCH  /admin/geo/areas/:id
 *   DELETE /admin/geo/areas/:id           软删
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { asc, count, eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { cities, areas, therapists } from '@loverush/db';

export const adminGeoRoutes = new Hono();
adminGeoRoutes.use('*', requireAuth, requireRole(['admin', 'ops']));

const TranslationsSchema = z.record(z.string());

const CityCreateBody = z.object({
  code: z.string().min(1).max(40),
  country_code: z.string().length(2),
  translations: TranslationsSchema,
  lat_center: z.string().nullable().optional(),
  lng_center: z.string().nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().optional(),
});
const CityPatchBody = CityCreateBody.partial().omit({ code: true });

const AreaCreateBody = z.object({
  code: z.string().min(1).max(40),
  translations: TranslationsSchema,
  lat_center: z.string().nullable().optional(),
  lng_center: z.string().nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().optional(),
});
const AreaPatchBody = AreaCreateBody.partial().omit({ code: true });

// ──────────────────── cities CRUD ────────────────────

adminGeoRoutes.get('/cities', async (c) => {
  const rows = await getDb().select().from(cities).orderBy(asc(cities.countryCode), asc(cities.sortOrder));
  return c.json({ data: rows });
});

adminGeoRoutes.post('/cities', zValidator('json', CityCreateBody), async (c) => {
  const body = c.req.valid('json');
  const [row] = await getDb()
    .insert(cities)
    .values({
      code: body.code,
      countryCode: body.country_code.toUpperCase(),
      translations: body.translations,
      latCenter: body.lat_center ?? null,
      lngCenter: body.lng_center ?? null,
      sortOrder: body.sort_order ?? 100,
      enabled: body.enabled === false ? 0 : 1,
    })
    .returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'geo.city.create',
    targetType: 'city',
    targetId: row?.id ?? body.code,
    before: null,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminGeoRoutes.patch('/cities/:id', zValidator('json', CityPatchBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const before = await getDb().query.cities.findFirst({ where: eq(cities.id, id) });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'city not found');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.country_code !== undefined) patch.countryCode = body.country_code.toUpperCase();
  if (body.translations !== undefined) patch.translations = body.translations;
  if (body.lat_center !== undefined) patch.latCenter = body.lat_center;
  if (body.lng_center !== undefined) patch.lngCenter = body.lng_center;
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;

  const [row] = await getDb().update(cities).set(patch).where(eq(cities.id, id)).returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'geo.city.update',
    targetType: 'city',
    targetId: id,
    before,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminGeoRoutes.delete('/cities/:id', async (c) => {
  const id = c.req.param('id');
  const before = await getDb().query.cities.findFirst({ where: eq(cities.id, id) });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'city not found');

  // 阻止误删:若有技师还在用,强提示
  const used = await getDb().select({ n: count() }).from(therapists).where(eq(therapists.serviceCityId, id));
  if ((used[0]?.n ?? 0) > 0) {
    throw HttpError.badRequest(
      ErrorCode.E0001_INVALID_PARAM,
      `${used[0]!.n} 位技师正在使用此城市 · 请先迁移再禁用`,
    );
  }

  await getDb().update(cities).set({ enabled: 0, updatedAt: new Date() }).where(eq(cities.id, id));
  await recordAudit({ db: getDb() }, c, {
    action: 'geo.city.disable',
    targetType: 'city',
    targetId: id,
    before,
    after: { ...before, enabled: 0 },
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});

// ──────────────────── areas CRUD ────────────────────

adminGeoRoutes.get('/cities/:cityId/areas', async (c) => {
  const cityId = c.req.param('cityId');
  const rows = await getDb()
    .select()
    .from(areas)
    .where(eq(areas.cityId, cityId))
    .orderBy(asc(areas.sortOrder));
  return c.json({ data: rows });
});

adminGeoRoutes.post('/cities/:cityId/areas', zValidator('json', AreaCreateBody), async (c) => {
  const cityId = c.req.param('cityId');
  const body = c.req.valid('json');

  const city = await getDb().query.cities.findFirst({ where: eq(cities.id, cityId) });
  if (!city) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'city not found');

  const [row] = await getDb()
    .insert(areas)
    .values({
      cityId,
      code: body.code,
      translations: body.translations,
      latCenter: body.lat_center ?? null,
      lngCenter: body.lng_center ?? null,
      sortOrder: body.sort_order ?? 100,
      enabled: body.enabled === false ? 0 : 1,
    })
    .returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'geo.area.create',
    targetType: 'area',
    targetId: row?.id ?? body.code,
    before: null,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminGeoRoutes.patch('/areas/:id', zValidator('json', AreaPatchBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const before = await getDb().query.areas.findFirst({ where: eq(areas.id, id) });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'area not found');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.translations !== undefined) patch.translations = body.translations;
  if (body.lat_center !== undefined) patch.latCenter = body.lat_center;
  if (body.lng_center !== undefined) patch.lngCenter = body.lng_center;
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;

  const [row] = await getDb().update(areas).set(patch).where(eq(areas.id, id)).returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'geo.area.update',
    targetType: 'area',
    targetId: id,
    before,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminGeoRoutes.delete('/areas/:id', async (c) => {
  const id = c.req.param('id');
  const before = await getDb().query.areas.findFirst({ where: eq(areas.id, id) });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'area not found');

  const used = await getDb().select({ n: count() }).from(therapists).where(eq(therapists.serviceAreaId, id));
  if ((used[0]?.n ?? 0) > 0) {
    throw HttpError.badRequest(
      ErrorCode.E0001_INVALID_PARAM,
      `${used[0]!.n} 位技师正在使用此区域 · 请先迁移再禁用`,
    );
  }

  await getDb().update(areas).set({ enabled: 0, updatedAt: new Date() }).where(eq(areas.id, id));
  await recordAudit({ db: getDb() }, c, {
    action: 'geo.area.disable',
    targetType: 'area',
    targetId: id,
    before,
    after: { ...before, enabled: 0 },
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});
