/**
 * 地理位置中枢 · 用户侧路由 · M02 Phase 5
 *
 * 端点(都 requireAuth):
 *   GET /geo/cities?country=TH&q=曼          // 城市列表 + 模糊搜索 · 按 locale 返 displayName
 *   GET /geo/cities/:cityId/areas             // 该城市下所有 areas
 *   GET /me/location-preference               // 客户当前偏好(name 已 resolve)
 *   PUT /me/location-preference               // 写入偏好
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { cities, areas, userLocationPreference, users } from '@loverush/db';

export const geoRoutes = new Hono();
geoRoutes.use('*', requireAuth);

function pickName(translations: Record<string, string> | null | undefined, locale: string | undefined, code: string): string {
  if (!translations) return code;
  return translations[locale ?? 'zh'] ?? translations.zh ?? translations.en ?? code;
}

// ──────────────────── GET /geo/cities ────────────────────

geoRoutes.get('/cities', async (c) => {
  const country = c.req.query('country')?.toUpperCase();
  const q = c.req.query('q')?.trim();
  const userId = c.get('userId') as string;

  // 取 user locale 用于翻译
  const me = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    columns: { locale: true },
  });
  const locale = me?.locale ?? 'zh';

  const conds = [eq(cities.enabled, 1)];
  if (country) conds.push(eq(cities.countryCode, country));
  if (q) {
    // 在 translations 任一 locale 模糊匹配
    conds.push(sql`${cities.translations}::text ILIKE ${'%' + q + '%'}`);
  }

  const rows = await getDb()
    .select()
    .from(cities)
    .where(and(...conds))
    .orderBy(asc(cities.sortOrder));

  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      code: r.code,
      country: r.countryCode,
      name: pickName(r.translations, locale, r.code),
    })),
  });
});

// ──────────────────── GET /geo/cities/:cityId/areas ────────────────────

geoRoutes.get('/cities/:cityId/areas', async (c) => {
  const cityId = c.req.param('cityId');
  const userId = c.get('userId') as string;
  const me = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    columns: { locale: true },
  });
  const locale = me?.locale ?? 'zh';

  const rows = await getDb()
    .select()
    .from(areas)
    .where(and(eq(areas.cityId, cityId), eq(areas.enabled, 1)))
    .orderBy(asc(areas.sortOrder));

  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      code: r.code,
      cityId: r.cityId,
      name: pickName(r.translations, locale, r.code),
    })),
  });
});

// ──────────────────── GET / PUT /me/location-preference ────────────────────

export const meLocationRoutes = new Hono();
meLocationRoutes.use('*', requireAuth);

const PutBody = z.object({
  city_id: z.string().uuid().nullable(),
  area_id: z.string().uuid().nullable().optional(),
  source: z.enum(['manual', 'inferred', 'gps_resolved']).optional().default('manual'),
});

meLocationRoutes.get('/', async (c) => {
  const userId = c.get('userId') as string;
  const me = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    columns: { locale: true },
  });
  const locale = me?.locale ?? 'zh';

  const pref = await getDb().query.userLocationPreference.findFirst({
    where: eq(userLocationPreference.userId, userId),
  });
  if (!pref) {
    return c.json({ data: null });
  }
  const city = pref.cityId
    ? await getDb().query.cities.findFirst({ where: eq(cities.id, pref.cityId) })
    : null;
  const area = pref.areaId
    ? await getDb().query.areas.findFirst({ where: eq(areas.id, pref.areaId) })
    : null;

  return c.json({
    data: {
      cityId: pref.cityId,
      cityCode: city?.code ?? null,
      cityName: city ? pickName(city.translations, locale, city.code) : null,
      areaId: pref.areaId,
      areaCode: area?.code ?? null,
      areaName: area ? pickName(area.translations, locale, area.code) : null,
      source: pref.source,
      updatedAt: pref.updatedAt,
    },
  });
});

meLocationRoutes.put('/', zValidator('json', PutBody), async (c) => {
  const userId = c.get('userId') as string;
  const body = c.req.valid('json');

  // 校验 city/area 存在 + 归属
  if (body.city_id) {
    const cityRow = await getDb().query.cities.findFirst({ where: eq(cities.id, body.city_id) });
    if (!cityRow) return c.json({ error: { code: 'E0003', message: 'city not found' } }, 404);
  }
  if (body.area_id) {
    const areaRow = await getDb().query.areas.findFirst({ where: eq(areas.id, body.area_id) });
    if (!areaRow) return c.json({ error: { code: 'E0003', message: 'area not found' } }, 404);
    if (body.city_id && areaRow.cityId !== body.city_id) {
      return c.json({ error: { code: 'E0001', message: 'area does not belong to city' } }, 400);
    }
  }

  // upsert
  await getDb()
    .insert(userLocationPreference)
    .values({
      userId,
      cityId: body.city_id,
      areaId: body.area_id ?? null,
      source: body.source ?? 'manual',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userLocationPreference.userId,
      set: {
        cityId: body.city_id,
        areaId: body.area_id ?? null,
        source: body.source ?? 'manual',
        updatedAt: new Date(),
      },
    });

  return c.json({ data: { ok: true } });
});
