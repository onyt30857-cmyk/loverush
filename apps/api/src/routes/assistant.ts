/**
 * AI 助理路由 · M03
 *
 * GET    /assistant/greet                动态打招呼(legacy · 保留)
 * GET    /assistant/home                 助理 Home 仪表盘(v2 · 模式 C 着陆页)
 * POST   /assistant/chat                 主对话(M03 · 注入 voice + memory + state)
 * POST   /assistant/onboarding/step      6 步首见对话剧本状态机(v2)
 * GET    /assistant/recommend            1→3 推荐(M03 · 含推荐理由)
 * POST   /assistant/recall-3             "下次帮我推 3 个"(收藏式延迟决策)
 * POST   /assistant/session/start        会话开始
 * POST   /assistant/session/finalize     会话结束(偏好归档)
 * GET    /assistant/memory/export        客户导出 JSON
 * POST   /assistant/memory/delete        一键擦除(标记 30 天 grace)
 * (handover-human 已撤 · 2026-05-28)
 *
 * POST   /me/blocks                      封锁某用户
 * DELETE /me/blocks/:userId              解锁
 * GET    /me/blocks                      已封锁列表
 * POST   /me/behavior/recompute          手动触发行为模式重算
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { chat as legacyChat, greet, type AssistantContext } from '../services/assistant';
import {
  chat as m03Chat,
  recall3,
  recommend as m03Recommend,
  readAllReference,
  readSaved,
  scheduleDeletion,
  start as sessionStart,
  finalize as sessionFinalize,
  getGateway,
  setOptOut,
  ensureState,
  getAssistantHome,
  refreshTodayPicks,
  onboardingStep,
} from '../services/assistant/index';
import { block, listBlocked, unblock, type BlockContext } from '../services/blockings';
import { computeBehaviorMode, upsertBehaviorProfile, type BehaviorContext } from '../services/behavior';
// import { createTicket, type TicketContext } from '../services/tickets'; // handover-human 撤后无引用

function actx(): AssistantContext {
  return { db: getDb() };
}
function rctx() {
  return { db: getDb() };
}
function bctx(): BlockContext {
  return { db: getDb() };
}
function bhctx(): BehaviorContext {
  return { db: getDb() };
}

// ──────────────── 校验 ────────────────

const ChatBody = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .optional(),
  locale_override: z.enum(['zh', 'en', 'th', 'vi', 'id', 'ms']).optional(),
});

const RecommendQuery = z.object({
  city: z.string().max(40).optional(),
  top_n: z.coerce.number().int().min(1).max(5).optional(),
  intent: z.string().max(200).optional(),
});

const Recall3Body = z.object({
  intent: z.string().max(200).optional(),
});

const SessionStartBody = z.object({
  session_token: z.string().min(8).max(128),
});

const SessionFinalizeBody = z.object({
  session_token: z.string().min(8).max(128),
  final_summary: z.string().max(2000).optional(),
});

const MemoryDeleteBody = z.object({
  confirm: z.literal(true),
});

const HomeQuery = z.object({
  locale_override: z.enum(['zh', 'en', 'th', 'vi', 'id', 'ms']).optional(),
});

const RefreshPicksBody = z.object({
  refresh_token: z.string().max(64).optional(),
  locale_override: z.enum(['zh', 'en', 'th', 'vi', 'id', 'ms']).optional(),
});

const OnboardingStepBody = z.object({
  step: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  payload: z.record(z.unknown()).default({}),
  locale_override: z.enum(['zh', 'en', 'th', 'vi', 'id', 'ms']).optional(),
});


const OutreachOptOutBody = z.object({
  disable_proactive: z.boolean().optional(),
  disable_silent_recall: z.boolean().optional(),
});

const BlockBody = z.object({
  target_user_id: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

// ──────────────── /assistant ────────────────

export const assistantRoutes = new Hono();
assistantRoutes.use('*', requireAuth);

// legacy 兼容入口 · 保留
assistantRoutes.get('/greet', async (c) => {
  const text = await greet(actx(), c.get('userId'));
  return c.json({ data: { content: text } });
});

// v3 · 助理 Home 仪表盘
assistantRoutes.get('/home', zValidator('query', HomeQuery), async (c) => {
  const q = c.req.valid('query');
  const userId = c.get('userId');
  const data = await getAssistantHome({ db: getDb() }, userId, q.locale_override, getGateway());
  return c.json({ data });
});

// v3 · 换 3 个 today_picks
assistantRoutes.post(
  '/home/refresh-picks',
  zValidator('json', RefreshPicksBody),
  async (c) => {
    const body = c.req.valid('json');
    const userId = c.get('userId');
    const data = await refreshTodayPicks({ db: getDb() }, userId, {
      refreshToken: body.refresh_token,
      gateway: getGateway(),
      localeOverride: body.locale_override,
    });
    return c.json({ data });
  },
);

// v2 · 6 步 onboarding 状态机
assistantRoutes.post('/onboarding/step', zValidator('json', OnboardingStepBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const data = await onboardingStep(
    { db: getDb() },
    getGateway(),
    userId,
    { step: body.step, payload: body.payload },
    body.locale_override,
  );
  return c.json({ data });
});

assistantRoutes.post('/chat', zValidator('json', ChatBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  // 优先走 M03 v2 链路 · 失败兜底走 legacy
  try {
    const res = await m03Chat({ db: getDb() }, {
      userId,
      message: body.message,
      history: body.history,
      localeOverride: body.locale_override,
    });
    return c.json({
      data: {
        content: res.content,
        scenario: res.scenario,
        joke_level: res.jokeLevel,
        serious_mode: res.seriousMode,
        filter_attempts: res.filterAttempts,
        locale: res.locale,
      },
    });
  } catch {
    const reply = await legacyChat(actx(), userId, body.message, body.history ?? []);
    return c.json({ data: { content: reply, scenario: 'casual', joke_level: 2 } });
  }
});

assistantRoutes.get('/recommend', zValidator('query', RecommendQuery), async (c) => {
  const q = c.req.valid('query');
  const userId = c.get('userId');
  const list = await m03Recommend(rctx(), getGateway(), {
    userId,
    city: q.city,
    topN: q.top_n,
    intent: q.intent,
  });
  return c.json({
    data: list.map((c) => ({
      therapist_id: c.therapist.id,
      avatar_url: c.therapist.avatarUrl,
      service_city: c.therapist.serviceCity,
      score_appearance: c.therapist.scoreAppearance,
      score_body: c.therapist.scoreBody,
      score_service: c.therapist.scoreService,
      rating: c.therapist.rating,
      online_status: c.therapist.onlineStatus,
      match_score: c.score,
      weight: c.weight,
      cluster_idx: c.clusterIdx,
      reason: c.reason,
    })),
  });
});

assistantRoutes.post('/recall-3', zValidator('json', Recall3Body), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const out = await recall3({ db: getDb() }, { userId, intent: body.intent });
  return c.json({ data: out });
});

assistantRoutes.post('/session/start', zValidator('json', SessionStartBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  await sessionStart({ db: getDb() }, { userId, sessionToken: body.session_token });
  await ensureState({ db: getDb() }, userId);
  return c.json({ data: { ok: true } });
});

assistantRoutes.post('/session/finalize', zValidator('json', SessionFinalizeBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const out = await sessionFinalize({ db: getDb() }, getGateway(), {
    userId,
    sessionToken: body.session_token,
    finalSummary: body.final_summary,
  });
  return c.json({ data: out });
});

assistantRoutes.get('/memory/export', async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const saved = await readSaved({ db }, userId);
  const ref = await readAllReference({ db }, userId, 100);
  // 标记 exported_at
  if (saved) {
    const { customerSavedMemory } = await import('@loverush/db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(customerSavedMemory)
      .set({ exportedAt: new Date() })
      .where(eq(customerSavedMemory.userId, userId));
  }
  return c.json({
    data: {
      generated_at: new Date().toISOString(),
      user_id: userId,
      saved_memory: saved,
      reference_memory: ref,
    },
  });
});

assistantRoutes.post('/memory/delete', zValidator('json', MemoryDeleteBody), async (c) => {
  const userId = c.get('userId');
  await scheduleDeletion({ db: getDb() }, userId);
  return c.json({
    data: {
      scheduled: true,
      message: '已标记 · 30 天 grace 后真删除 · 期间随时可恢复',
    },
  });
});

assistantRoutes.post('/outreach/opt-out', zValidator('json', OutreachOptOutBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  await setOptOut({ db: getDb() }, userId, {
    disableProactive: body.disable_proactive,
    disableRecall: body.disable_silent_recall,
  });
  return c.json({ data: { ok: true } });
});

// 一键封锁
export const blockRoutes = new Hono();
blockRoutes.use('*', requireAuth);

blockRoutes.post('/', zValidator('json', BlockBody), async (c) => {
  const body = c.req.valid('json');
  const row = await block(bctx(), {
    blockerUserId: c.get('userId'),
    blockedUserId: body.target_user_id,
    reason: body.reason,
  });
  return c.json({ data: row });
});

blockRoutes.delete('/:targetUserId', async (c) => {
  await unblock(bctx(), {
    blockerUserId: c.get('userId'),
    blockedUserId: c.req.param('targetUserId'),
  });
  return c.json({ data: { ok: true } });
});

blockRoutes.get('/', async (c) => {
  const list = await listBlocked(bctx(), c.get('userId'));
  return c.json({ data: list });
});

// 行为画像重算
export const behaviorRoutes = new Hono();
behaviorRoutes.use('*', requireAuth);

behaviorRoutes.post('/recompute', async (c) => {
  const userId = c.get('userId');
  const computed = await computeBehaviorMode(bhctx(), userId);
  const saved = await upsertBehaviorProfile(bhctx(), userId, computed);
  return c.json({ data: saved });
});
