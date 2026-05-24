/**
 * AI 助理路由 · M03
 *
 * GET    /assistant/greet               动态打招呼
 * POST   /assistant/chat                连续对话
 * GET    /assistant/recommend           推荐 1-3 个技师
 * POST   /me/blocks                     封锁某用户
 * DELETE /me/blocks/:userId             解锁
 * GET    /me/blocks                     已封锁列表
 * POST   /me/behavior/recompute         手动触发行为模式重算
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { chat, greet, type AssistantContext } from '../services/assistant';
import { recommend, type RecommendContext } from '../services/recommend';
import { block, listBlocked, unblock, type BlockContext } from '../services/blockings';
import { computeBehaviorMode, upsertBehaviorProfile, type BehaviorContext } from '../services/behavior';

function actx(): AssistantContext {
  return { db: getDb() };
}
function rctx(): RecommendContext {
  return { db: getDb() };
}
function bctx(): BlockContext {
  return { db: getDb() };
}
function bhctx(): BehaviorContext {
  return { db: getDb() };
}

const ChatBody = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .optional(),
});

const RecommendQuery = z.object({
  city: z.string().max(40).optional(),
  top_n: z.coerce.number().int().min(1).max(20).optional(),
  intent: z.string().max(200).optional(),
});

const BlockBody = z.object({
  target_user_id: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const assistantRoutes = new Hono();
assistantRoutes.use('*', requireAuth);

assistantRoutes.get('/greet', async (c) => {
  const text = await greet(actx(), c.get('userId') as string);
  return c.json({ data: { content: text } });
});

assistantRoutes.post('/chat', zValidator('json', ChatBody), async (c) => {
  const body = c.req.valid('json');
  const reply = await chat(actx(), c.get('userId') as string, body.message, body.history ?? []);
  return c.json({ data: { content: reply } });
});

assistantRoutes.get('/recommend', zValidator('query', RecommendQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await recommend(rctx(), {
    customerId: c.get('userId') as string,
    city: q.city,
    topN: q.top_n,
    intent: q.intent,
  });
  return c.json({
    data: list.map((c) => ({
      therapist_id: c.therapist.id,
      display_name: c.therapist.bio?.slice(0, 20) ?? null,
      avatar_url: c.therapist.avatarUrl,
      score_appearance: c.therapist.scoreAppearance,
      score_body: c.therapist.scoreBody,
      score_service: c.therapist.scoreService,
      rating: c.therapist.rating,
      service_city: c.therapist.serviceCity,
      online_status: c.therapist.onlineStatus,
      match_score: c.score,
      match_factors: c.factors,
    })),
  });
});

// 一键封锁
export const blockRoutes = new Hono();
blockRoutes.use('*', requireAuth);

blockRoutes.post('/', zValidator('json', BlockBody), async (c) => {
  const body = c.req.valid('json');
  const row = await block(bctx(), {
    blockerUserId: c.get('userId') as string,
    blockedUserId: body.target_user_id,
    reason: body.reason,
  });
  return c.json({ data: row });
});

blockRoutes.delete('/:targetUserId', async (c) => {
  await unblock(bctx(), {
    blockerUserId: c.get('userId') as string,
    blockedUserId: c.req.param('targetUserId'),
  });
  return c.json({ data: { ok: true } });
});

blockRoutes.get('/', async (c) => {
  const list = await listBlocked(bctx(), c.get('userId') as string);
  return c.json({ data: list });
});

// 行为画像重算
export const behaviorRoutes = new Hono();
behaviorRoutes.use('*', requireAuth);

behaviorRoutes.post('/recompute', async (c) => {
  const userId = c.get('userId') as string;
  const computed = await computeBehaviorMode(bhctx(), userId);
  const saved = await upsertBehaviorProfile(bhctx(), userId, computed);
  return c.json({ data: saved });
});
