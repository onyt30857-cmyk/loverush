/**
 * M04 · 对话式意图匹配路由
 *
 * POST /match/conversational
 *   body: { intent_text?, city?, top_n? }
 *   返回: { mode: 'llm'|'rule', candidates: [{ id, display_name, ..., match_score, reasons }] }
 *
 * 召回返回的 therapist 未 join users,这里补 display_name 给前端。
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { inArray } from 'drizzle-orm';
import { users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { matchConversational } from '../services/match';

export const matchRoutes = new Hono();
matchRoutes.use('*', requireAuth);

const ConvBody = z.object({
  intent_text: z.string().max(500).optional(),
  city: z.string().max(60).optional(),
  top_n: z.number().int().min(1).max(10).optional(),
});

matchRoutes.post('/conversational', zValidator('json', ConvBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const db = getDb();

  const { results, mode } = await matchConversational(
    { db },
    {
      customerId: userId,
      intentText: body.intent_text,
      city: body.city,
      topN: body.top_n,
    },
  );

  // 召回返回的 therapist 未 join users · 补 display_name
  const userIds = results.map((r) => r.therapist.userId);
  const us = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];
  const nameById = new Map(us.map((u) => [u.id, u.displayName]));

  return c.json({
    data: {
      mode,
      candidates: results.map((r) => ({
        id: r.therapist.id,
        display_name: nameById.get(r.therapist.userId) ?? null,
        avatar_url: r.therapist.avatarUrl,
        tags: r.therapist.tags ?? [],
        nationality: r.therapist.nationality,
        score_service: r.therapist.scoreService,
        online: r.therapist.onlineStatus === 'online',
        base_price: r.therapist.basePriceJson ?? [],
        match_score: r.score,
        reasons: r.reasons,
      })),
    },
  });
});
