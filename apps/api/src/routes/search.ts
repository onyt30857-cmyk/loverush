/**
 * 搜索路由 · M02 Phase 2/4
 *
 * Phase 2:
 *   POST   /search/parse              自然语言 → 结构化条件 · NLP Haiku
 *
 * Phase 4(搜索后台):
 *   POST   /search/log                写一条搜索行为日志 · 返回 logId
 *   PATCH  /search/log/:id/click      用户点击技师卡时回写 clickedTherapistId
 *   GET    /search/hot-keywords       拉热门词 + 类目(运营可配 · 替换前端硬编码)
 *
 * 所有端点 requireAuth · 日志失败不阻塞 UX
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { parseSearchNlp } from '../services/search-nlp';
import { getGateway } from '../services/assistant/index';
import { getDb } from '../db';
import { searchQueryLogs, searchHotKeywords, searchCategories } from '@loverush/db';

const ParseBody = z.object({
  q: z.string().min(1).max(200),
});

const LogBody = z.object({
  raw_query: z.string().min(1).max(500),
  parsed_query: z.record(z.unknown()).optional(),
  result_count: z.number().int().nonnegative(),
  personalized: z.boolean().optional(),
});

const ClickBody = z.object({
  therapist_id: z.string().uuid(),
});

export const searchRoutes = new Hono();

searchRoutes.use('*', requireAuth);

// ──────────────────── Phase 2 · NLP 解析 ────────────────────

searchRoutes.post('/parse', zValidator('json', ParseBody), async (c) => {
  const body = c.req.valid('json');
  const parsed = await parseSearchNlp(getGateway(), body.q);
  return c.json({ data: parsed });
});

// ──────────────────── Phase 4 · 搜索日志 ────────────────────

searchRoutes.post('/log', zValidator('json', LogBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const locale = c.req.header('accept-language')?.split(',')[0]?.split('-').slice(0, 2).join('-');

  try {
    const [row] = await getDb()
      .insert(searchQueryLogs)
      .values({
        userId,
        rawQuery: body.raw_query,
        parsedQuery: body.parsed_query ?? null,
        resultCount: body.result_count,
        personalized: body.personalized ? 1 : 0,
        locale: locale ?? null,
      })
      .returning({ id: searchQueryLogs.id });
    return c.json({ data: { log_id: row?.id ?? null } });
  } catch {
    // 写日志失败不影响 UX · 静默
    return c.json({ data: { log_id: null } });
  }
});

searchRoutes.patch('/log/:id/click', zValidator('json', ClickBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;

  try {
    await getDb()
      .update(searchQueryLogs)
      .set({
        clickedTherapistId: body.therapist_id,
        clickedAt: new Date(),
      })
      .where(and(eq(searchQueryLogs.id, id), eq(searchQueryLogs.userId, userId)));
    return c.json({ data: { ok: true } });
  } catch {
    return c.json({ data: { ok: false } });
  }
});

// ──────────────────── Phase 4 · 热门词 + 类目 ────────────────────

searchRoutes.get('/hot-keywords', async (c) => {
  const locale = c.req.query('locale');
  const city = c.req.query('city');
  const db = getDb();
  const now = new Date();

  // 通用条件:enabled=1 · 时段命中 · locale/city 命中(null = 全投放)
  const localeOk = locale
    ? or(isNull(searchHotKeywords.targetLocales), sql`${locale} = ANY(${searchHotKeywords.targetLocales})`)
    : isNull(searchHotKeywords.targetLocales);
  const cityOk = city
    ? or(isNull(searchHotKeywords.targetCities), sql`${city} = ANY(${searchHotKeywords.targetCities})`)
    : isNull(searchHotKeywords.targetCities);
  const timeOk = and(
    or(isNull(searchHotKeywords.startsAt), lte(searchHotKeywords.startsAt, now)),
    or(isNull(searchHotKeywords.endsAt), gte(searchHotKeywords.endsAt, now)),
  );

  const hotRows = await db
    .select()
    .from(searchHotKeywords)
    .where(and(eq(searchHotKeywords.enabled, 1), timeOk, localeOk ?? sql`true`, cityOk ?? sql`true`))
    .orderBy(searchHotKeywords.sortOrder)
    .limit(20);

  // 类目同样过滤逻辑(不限时段 · 只有 locale/city)
  const catLocaleOk = locale
    ? or(isNull(searchCategories.targetLocales), sql`${locale} = ANY(${searchCategories.targetLocales})`)
    : isNull(searchCategories.targetLocales);
  const catCityOk = city
    ? or(isNull(searchCategories.targetCities), sql`${city} = ANY(${searchCategories.targetCities})`)
    : isNull(searchCategories.targetCities);

  const catRows = await db
    .select()
    .from(searchCategories)
    .where(and(eq(searchCategories.enabled, 1), catLocaleOk ?? sql`true`, catCityOk ?? sql`true`))
    .orderBy(searchCategories.sortOrder)
    .limit(12);

  return c.json({
    data: {
      hot_keywords: hotRows.map((r) => ({
        id: r.id,
        keyword: r.keyword,
        label: r.displayLabel,
      })),
      categories: catRows.map((r) => ({
        id: r.id,
        code: r.code,
        emoji: r.emoji,
        label: r.label,
        filter_condition: r.filterCondition,
      })),
    },
  });
});
