/**
 * Admin · 搜索后台路由 · M02 Phase 4
 *
 * 路径前缀:/admin/search
 * 权限:requireRole(['admin', 'ops'])
 * 审计:每次写操作走 recordAudit
 *
 * 端点:
 *  看板:
 *    GET    /admin/search/overview                24h/7d/30d 搜索量 + 唯一用户 + 零结果率 + CTR
 *    GET    /admin/search/queries/hot?range=7d    热门词 TOP 50
 *    GET    /admin/search/queries/zero?range=7d   零结果词 TOP 50(指导补内容)
 *    GET    /admin/search/queries/raw?...         明细 + 过滤(分页)
 *
 *  热门词 CRUD:
 *    GET    /admin/search/keywords
 *    POST   /admin/search/keywords
 *    PATCH  /admin/search/keywords/:id
 *    DELETE /admin/search/keywords/:id           软删 enabled=0
 *
 *  类目 CRUD:
 *    GET    /admin/search/categories
 *    POST   /admin/search/categories
 *    PATCH  /admin/search/categories/:id
 *    DELETE /admin/search/categories/:id          软删 enabled=0
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { searchQueryLogs, searchHotKeywords, searchCategories } from '@loverush/db';

export const adminSearchRoutes = new Hono();
adminSearchRoutes.use('*', requireAuth, requireRole(['admin', 'ops']));

// ──────────────────── 看板查询辅助 ────────────────────

function rangeToInterval(range: string | undefined): string {
  switch (range) {
    case '24h':
      return '24 hours';
    case '30d':
      return '30 days';
    case '7d':
    default:
      return '7 days';
  }
}

// ──────────────────── 看板:总览 ────────────────────

adminSearchRoutes.get('/overview', async (c) => {
  const db = getDb();
  const ranges = ['24 hours', '7 days', '30 days'] as const;

  const out: Record<string, unknown> = {};
  for (const r of ranges) {
    const rows = (await db.execute(sql`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(DISTINCT user_id)::int                           AS unique_users,
        COUNT(*) FILTER (WHERE result_count = 0)::int          AS zero_count,
        COUNT(*) FILTER (WHERE clicked_therapist_id IS NOT NULL)::int AS click_count,
        COUNT(*) FILTER (WHERE personalized = 1)::int          AS personalized_count
      FROM search_query_logs
      WHERE occurred_at >= NOW() - INTERVAL '${sql.raw(r)}'
    `)) as Array<{
      total: number;
      unique_users: number;
      zero_count: number;
      click_count: number;
      personalized_count: number;
    }>;
    const row = rows[0] ?? { total: 0, unique_users: 0, zero_count: 0, click_count: 0, personalized_count: 0 };
    const key = r === '24 hours' ? '24h' : r === '7 days' ? '7d' : '30d';
    out[key] = {
      total: row.total,
      unique_users: row.unique_users,
      zero_count: row.zero_count,
      click_count: row.click_count,
      personalized_count: row.personalized_count,
      zero_rate: row.total ? +(row.zero_count / row.total).toFixed(4) : 0,
      ctr: row.total ? +(row.click_count / row.total).toFixed(4) : 0,
      personalized_rate: row.total ? +(row.personalized_count / row.total).toFixed(4) : 0,
    };
  }
  return c.json({ data: out });
});

// ──────────────────── 看板:热门词 ────────────────────

adminSearchRoutes.get('/queries/hot', async (c) => {
  const range = rangeToInterval(c.req.query('range'));
  const rows = (await getDb().execute(sql`
    SELECT
      raw_query,
      COUNT(*)::int                                                  AS count,
      COUNT(DISTINCT user_id)::int                                   AS unique_users,
      COUNT(*) FILTER (WHERE clicked_therapist_id IS NOT NULL)::int  AS clicks,
      AVG(result_count)::float                                       AS avg_result_count
    FROM search_query_logs
    WHERE occurred_at >= NOW() - INTERVAL '${sql.raw(range)}'
      AND result_count > 0
    GROUP BY raw_query
    ORDER BY count DESC
    LIMIT 50
  `)) as Array<{ raw_query: string; count: number; unique_users: number; clicks: number; avg_result_count: number }>;
  return c.json({
    data: rows.map((r) => ({
      raw_query: r.raw_query,
      count: r.count,
      unique_users: r.unique_users,
      clicks: r.clicks,
      ctr: r.count ? +(r.clicks / r.count).toFixed(4) : 0,
      avg_result_count: Math.round(r.avg_result_count ?? 0),
    })),
  });
});

// ──────────────────── 看板:零结果词 ────────────────────

adminSearchRoutes.get('/queries/zero', async (c) => {
  const range = rangeToInterval(c.req.query('range'));
  const rows = (await getDb().execute(sql`
    SELECT
      raw_query,
      COUNT(*)::int                AS count,
      COUNT(DISTINCT user_id)::int AS unique_users,
      MAX(occurred_at)             AS last_seen
    FROM search_query_logs
    WHERE occurred_at >= NOW() - INTERVAL '${sql.raw(range)}'
      AND result_count = 0
    GROUP BY raw_query
    ORDER BY count DESC, last_seen DESC
    LIMIT 50
  `)) as Array<{ raw_query: string; count: number; unique_users: number; last_seen: string }>;
  return c.json({ data: rows });
});

// ──────────────────── 看板:明细列表 ────────────────────

adminSearchRoutes.get('/queries/raw', async (c) => {
  const range = rangeToInterval(c.req.query('range'));
  const q = c.req.query('q')?.trim() ?? '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

  const where = q
    ? sql`occurred_at >= NOW() - INTERVAL '${sql.raw(range)}' AND raw_query ILIKE ${'%' + q + '%'}`
    : sql`occurred_at >= NOW() - INTERVAL '${sql.raw(range)}'`;

  const rows = (await getDb().execute(sql`
    SELECT id, user_id, raw_query, parsed_query, result_count, personalized,
           clicked_therapist_id, clicked_at, locale, occurred_at
    FROM search_query_logs
    WHERE ${where}
    ORDER BY occurred_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as Array<Record<string, unknown>>;
  return c.json({ data: rows, meta: { limit, offset } });
});

// ──────────────────── 热门词 CRUD ────────────────────

const HotKeywordBody = z.object({
  keyword: z.string().min(1).max(80),
  display_label: z.string().min(1).max(80),
  sort_order: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().optional(),
  target_locales: z.array(z.string()).max(10).nullable().optional(),
  target_cities: z.array(z.string()).max(20).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
});

const HotKeywordPatchBody = HotKeywordBody.partial();

adminSearchRoutes.get('/keywords', async (c) => {
  const rows = await getDb()
    .select()
    .from(searchHotKeywords)
    .orderBy(searchHotKeywords.sortOrder, desc(searchHotKeywords.createdAt));
  return c.json({ data: rows });
});

adminSearchRoutes.post('/keywords', zValidator('json', HotKeywordBody), async (c) => {
  const body = c.req.valid('json');
  const actorId = c.get('userId') as string;
  const [row] = await getDb()
    .insert(searchHotKeywords)
    .values({
      keyword: body.keyword,
      displayLabel: body.display_label,
      sortOrder: body.sort_order ?? 100,
      enabled: body.enabled === false ? 0 : 1,
      targetLocales: body.target_locales ?? null,
      targetCities: body.target_cities ?? null,
      startsAt: body.starts_at ? new Date(body.starts_at) : null,
      endsAt: body.ends_at ? new Date(body.ends_at) : null,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'search.keyword.create',
    targetType: 'search_hot_keyword',
    targetId: row?.id ?? body.keyword,
    before: null,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminSearchRoutes.patch('/keywords/:id', zValidator('json', HotKeywordPatchBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const actorId = c.get('userId') as string;

  const before = await getDb().query.searchHotKeywords.findFirst({
    where: eq(searchHotKeywords.id, id),
  });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'hot keyword not found');

  const patch: Record<string, unknown> = { updatedBy: actorId, updatedAt: new Date() };
  if (body.keyword !== undefined) patch.keyword = body.keyword;
  if (body.display_label !== undefined) patch.displayLabel = body.display_label;
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
  if (body.target_locales !== undefined) patch.targetLocales = body.target_locales;
  if (body.target_cities !== undefined) patch.targetCities = body.target_cities;
  if (body.starts_at !== undefined) patch.startsAt = body.starts_at ? new Date(body.starts_at) : null;
  if (body.ends_at !== undefined) patch.endsAt = body.ends_at ? new Date(body.ends_at) : null;

  const [row] = await getDb()
    .update(searchHotKeywords)
    .set(patch)
    .where(eq(searchHotKeywords.id, id))
    .returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'search.keyword.update',
    targetType: 'search_hot_keyword',
    targetId: id,
    before,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminSearchRoutes.delete('/keywords/:id', async (c) => {
  const id = c.req.param('id');
  const actorId = c.get('userId') as string;
  const before = await getDb().query.searchHotKeywords.findFirst({
    where: eq(searchHotKeywords.id, id),
  });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'hot keyword not found');

  await getDb()
    .update(searchHotKeywords)
    .set({ enabled: 0, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(searchHotKeywords.id, id));
  await recordAudit({ db: getDb() }, c, {
    action: 'search.keyword.disable',
    targetType: 'search_hot_keyword',
    targetId: id,
    before,
    after: { ...before, enabled: 0 },
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});

// ──────────────────── 类目 CRUD ────────────────────

const CategoryBody = z.object({
  code: z.string().min(1).max(40),
  emoji: z.string().max(8).nullable().optional(),
  label: z.string().min(1).max(40),
  sort_order: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().optional(),
  filter_condition: z.record(z.unknown()).nullable().optional(),
  target_locales: z.array(z.string()).max(10).nullable().optional(),
  target_cities: z.array(z.string()).max(20).nullable().optional(),
});

const CategoryPatchBody = CategoryBody.partial();

adminSearchRoutes.get('/categories', async (c) => {
  const rows = await getDb()
    .select()
    .from(searchCategories)
    .orderBy(searchCategories.sortOrder, desc(searchCategories.createdAt));
  return c.json({ data: rows });
});

adminSearchRoutes.post('/categories', zValidator('json', CategoryBody), async (c) => {
  const body = c.req.valid('json');
  const actorId = c.get('userId') as string;
  const [row] = await getDb()
    .insert(searchCategories)
    .values({
      code: body.code,
      emoji: body.emoji ?? null,
      label: body.label,
      sortOrder: body.sort_order ?? 100,
      enabled: body.enabled === false ? 0 : 1,
      filterCondition: body.filter_condition ?? null,
      targetLocales: body.target_locales ?? null,
      targetCities: body.target_cities ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'search.category.create',
    targetType: 'search_category',
    targetId: row?.id ?? body.code,
    before: null,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminSearchRoutes.patch('/categories/:id', zValidator('json', CategoryPatchBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const actorId = c.get('userId') as string;

  const before = await getDb().query.searchCategories.findFirst({
    where: eq(searchCategories.id, id),
  });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'category not found');

  const patch: Record<string, unknown> = { updatedBy: actorId, updatedAt: new Date() };
  if (body.code !== undefined) patch.code = body.code;
  if (body.emoji !== undefined) patch.emoji = body.emoji;
  if (body.label !== undefined) patch.label = body.label;
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
  if (body.filter_condition !== undefined) patch.filterCondition = body.filter_condition;
  if (body.target_locales !== undefined) patch.targetLocales = body.target_locales;
  if (body.target_cities !== undefined) patch.targetCities = body.target_cities;

  const [row] = await getDb()
    .update(searchCategories)
    .set(patch)
    .where(eq(searchCategories.id, id))
    .returning();
  await recordAudit({ db: getDb() }, c, {
    action: 'search.category.update',
    targetType: 'search_category',
    targetId: id,
    before,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminSearchRoutes.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const actorId = c.get('userId') as string;
  const before = await getDb().query.searchCategories.findFirst({
    where: eq(searchCategories.id, id),
  });
  if (!before) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'category not found');

  await getDb()
    .update(searchCategories)
    .set({ enabled: 0, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(searchCategories.id, id));
  await recordAudit({ db: getDb() }, c, {
    action: 'search.category.disable',
    targetType: 'search_category',
    targetId: id,
    before,
    after: { ...before, enabled: 0 },
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});

// 防止意外用作非 admin 路径(暴露 keyword 用 GET /search/hot-keywords)
// 避免本路由被错挂载到 /search 前缀:无 / 端点
