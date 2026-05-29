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

  // M02 Phase 5.1 · 数据驱动 · LEFT JOIN therapists + COUNT
  // 双轨匹配:优先 service_city_id · 旧 text 用 translations.zh/en 兜底
  // 只数 verification_status='passed' 的技师(真实可被撮合)
  const rows = (await getDb().execute(sql`
    SELECT
      cities.id,
      cities.code,
      cities.country_code,
      cities.translations,
      cities.sort_order,
      COUNT(t.id) FILTER (WHERE t.verification_status='passed')::int AS therapist_count
    FROM cities
    LEFT JOIN therapists t ON (
      t.service_city_id = cities.id
      OR (t.service_city_id IS NULL AND t.service_city = cities.translations->>'zh')
      OR (t.service_city_id IS NULL AND t.service_city = cities.translations->>'en')
    )
    WHERE cities.enabled = 1
      ${country ? sql`AND cities.country_code = ${country}` : sql``}
      ${q ? sql`AND cities.translations::text ILIKE ${'%' + q + '%'}` : sql``}
    GROUP BY cities.id, cities.code, cities.country_code, cities.translations, cities.sort_order
    ORDER BY cities.country_code, cities.sort_order
  `)) as Array<{
    id: string;
    code: string;
    country_code: string;
    translations: Record<string, string>;
    sort_order: number;
    therapist_count: number;
  }>;

  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      code: r.code,
      country: r.country_code,
      name: pickName(r.translations, locale, r.code),
      therapistCount: r.therapist_count,
    })),
  });
});

// ──────────────────── GET /geo/countries ────────────────────

const COUNTRY_META: Record<string, { flag: string; nameZh: string; nameEn: string }> = {
  TH: { flag: '🇹🇭', nameZh: '泰国', nameEn: 'Thailand' },
  MY: { flag: '🇲🇾', nameZh: '马来西亚', nameEn: 'Malaysia' },
  VN: { flag: '🇻🇳', nameZh: '越南', nameEn: 'Vietnam' },
  ID: { flag: '🇮🇩', nameZh: '印度尼西亚', nameEn: 'Indonesia' },
};

geoRoutes.get('/countries', async (c) => {
  const userId = c.get('userId') as string;
  const me = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    columns: { locale: true },
  });
  const locale = me?.locale ?? 'zh';

  // 一次 query · 按 country_code 分组 + 聚合 therapist + city
  const rows = (await getDb().execute(sql`
    SELECT
      cities.country_code,
      COUNT(DISTINCT cities.id)::int AS city_count,
      COUNT(t.id) FILTER (WHERE t.verification_status='passed')::int AS therapist_count
    FROM cities
    LEFT JOIN therapists t ON (
      t.service_city_id = cities.id
      OR (t.service_city_id IS NULL AND t.service_city = cities.translations->>'zh')
      OR (t.service_city_id IS NULL AND t.service_city = cities.translations->>'en')
    )
    WHERE cities.enabled = 1
    GROUP BY cities.country_code
    ORDER BY cities.country_code
  `)) as Array<{ country_code: string; city_count: number; therapist_count: number }>;

  return c.json({
    data: rows.map((r) => {
      const meta = COUNTRY_META[r.country_code];
      return {
        country: r.country_code,
        flag: meta?.flag ?? '🌍',
        label: locale === 'en' ? meta?.nameEn ?? r.country_code : meta?.nameZh ?? r.country_code,
        cityCount: r.city_count,
        therapistCount: r.therapist_count,
      };
    }),
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

  // 也走 aggregate · 每区域含 therapist_count
  const rows = (await getDb().execute(sql`
    SELECT
      areas.id, areas.code, areas.city_id, areas.translations, areas.sort_order,
      COUNT(t.id) FILTER (WHERE t.verification_status='passed')::int AS therapist_count
    FROM areas
    LEFT JOIN therapists t ON (
      t.service_area_id = areas.id
      OR (t.service_area_id IS NULL AND t.service_area = areas.translations->>'zh')
      OR (t.service_area_id IS NULL AND t.service_area = areas.translations->>'en')
    )
    WHERE areas.city_id = ${cityId} AND areas.enabled = 1
    GROUP BY areas.id, areas.code, areas.city_id, areas.translations, areas.sort_order
    ORDER BY areas.sort_order
  `)) as Array<{
    id: string;
    code: string;
    city_id: string;
    translations: Record<string, string>;
    sort_order: number;
    therapist_count: number;
  }>;

  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      code: r.code,
      cityId: r.city_id,
      name: pickName(r.translations, locale, r.code),
      therapistCount: r.therapist_count,
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
