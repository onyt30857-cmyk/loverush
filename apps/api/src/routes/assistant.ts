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
// v5 语音助理 ([[loverush_m03_audit_2026_06_01]])
// 2026-06-02 切到 Claude 文本版 · 前端 Web Speech 转字 → 后端 Claude · 不再走 Gemini multimodal audio
import {
  processVoiceTurn,
  loadHistory as loadVoiceHistory,
  logTurn as logVoiceTurn,
  loadTherapistNames,
  type VoiceContext,
} from '../services/assistant/voice-claude';
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
  // 9 步 · 对齐 0522 信息采集表
  step: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
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
        quick_replies: res.quickReplies,
      },
    });
  } catch {
    const reply = await legacyChat(actx(), userId, body.message, body.history ?? []);
    return c.json({ data: { content: reply, scenario: 'casual', joke_level: 2 } });
  }
});

// 客户跨设备 / 清缓存恢复历史 · 从 assistant_chat_log 拉客户自己的对话
// 默认取最近 50 轮(每轮 = user + assistant 两条消息)· 按时间正序返回
const ChatHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before_ts: z.string().datetime().optional(),
});

assistantRoutes.get('/chat/history', zValidator('query', ChatHistoryQuery), async (c) => {
  const q = c.req.valid('query');
  const userId = c.get('userId');
  const limit = q.limit ?? 50;
  const db = getDb();
  const { assistantChatLog } = await import('@loverush/db');
  const { eq, desc, lt, and } = await import('drizzle-orm');

  const conds = q.before_ts
    ? and(eq(assistantChatLog.userId, userId), lt(assistantChatLog.createdAt, new Date(q.before_ts)))
    : eq(assistantChatLog.userId, userId);

  const rows = await db
    .select({
      id: assistantChatLog.id,
      userInput: assistantChatLog.userInput,
      finalContent: assistantChatLog.finalContent,
      scenario: assistantChatLog.scenario,
      createdAt: assistantChatLog.createdAt,
    })
    .from(assistantChatLog)
    .where(conds)
    .orderBy(desc(assistantChatLog.createdAt))
    .limit(limit);

  // 反转为正序 + 每行展开为 2 条 turns(user + assistant)
  const turns = rows.reverse().flatMap((r) => [
    {
      id: `${r.id}-u`,
      role: 'user' as const,
      content: r.userInput,
      ts: r.createdAt.getTime(),
    },
    {
      id: `${r.id}-a`,
      role: 'assistant' as const,
      content: r.finalContent,
      ts: r.createdAt.getTime() + 1,
    },
  ]);

  return c.json({ data: turns });
});

/** 私聊找话题 · 给客户在对话页点'💬 找话题'生成 3 个开场白 */
const TopicsQuery = z.object({
  therapist_id: z.string().uuid(),
  locale: z.enum(['zh', 'en']).optional(),
});

assistantRoutes.get('/topics', zValidator('query', TopicsQuery), async (c) => {
  const q = c.req.valid('query');
  const { suggestTopics } = await import('../services/assistant/topics');
  const topics = await suggestTopics(rctx(), getGateway(), {
    therapistId: q.therapist_id,
    locale: q.locale,
  });
  return c.json({ data: { topics } });
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

// ──────── v5 语音助理 endpoint (2026-06-02 [[loverush_m03_audit_2026_06_01]] v5) ────────
// 2026-06-02 切到 Claude 文本版 · 前端 Web Speech 转字 → 后端 Claude(LLMGateway · forceProvider 'anthropic')
//
// POST /assistant/voice · JSON body {text, session_id?, turn_idx?}
//   1. 拿前端转好的字
//   2. 调 LLMGateway T2 · forceProvider 'anthropic' → Claude Haiku
//   3. structured JSON: {replyText, recommendIntent?}
//   4. 若 recommendIntent · 调 m03Recommend 拿 3 个技师
//   5. logTurn 写 chat_log 跨会话历史
//   6. 返 {transcript, replyText, recommendations, session_id, turn_idx}
assistantRoutes.post('/voice', async (c) => {
  const userId = c.get('userId');
  const t0 = Date.now();

  // 解析 JSON · 前端发 {text, session_id?, turn_idx?}
  let body: { text?: string; session_id?: string; turn_idx?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_JSON', message: '请用 JSON body 提交 {text}' } }, 400);
  }
  const text = String(body.text ?? '').trim();
  if (!text) {
    return c.json({ error: { code: 'MISSING_TEXT', message: '缺少 text · 前端没转出字' } }, 400);
  }
  // text 兜底硬上限 · 防 prompt 注入超长
  if (text.length > 800) {
    return c.json({ error: { code: 'TEXT_TOO_LONG', message: '说太多了 · 一次 800 字内' } }, 400);
  }
  const sessionId = String(body.session_id ?? `s-${Date.now()}`);
  const turnIdx = Number(body.turn_idx ?? 0);

  // 加载跨会话历史 (最近 10 轮)
  const ctx: VoiceContext = { db: getDb() };
  const history = await loadVoiceHistory(ctx, userId, 10);

  // 调 Claude · 文本理解
  let voiceResult;
  try {
    voiceResult = await processVoiceTurn({
      gateway: getGateway(),
      text,
      history,
      userId,
    });
  } catch (err) {
    const detail = String((err as Error).message ?? err);
    console.error('[voice] processVoiceTurn failed', {
      userId,
      textLen: text.length,
      detail,
    });
    return c.json(
      {
        error: {
          code: 'LLM_ERROR',
          message: '小助理刚走神了一下 · 再说一遍',
          detail: detail.slice(0, 300),
        },
      },
      503,
    );
  }

  // 若有推荐意图 · 调现有 recommender
  let recommendations: Array<unknown> = [];
  if (voiceResult.recommendIntent) {
    try {
      const list = await m03Recommend(rctx(), getGateway(), {
        userId,
        city: voiceResult.recommendIntent.city,
        intent: voiceResult.recommendIntent.description,
        topN: 3,
      });
      // recommender 返的 therapist 没 join users · 单独拉 displayName
      const therapistUserIds = list.map((r) => r.therapist.userId);
      const nameMap = await loadTherapistNames(ctx, therapistUserIds);
      recommendations = list.map((r) => ({
        therapist_id: r.therapist.id,
        display_name: nameMap.get(r.therapist.userId) ?? '技师',
        avatar_url: r.therapist.avatarUrl,
        city: r.therapist.serviceCity,
        online_status: r.therapist.onlineStatus,
        reason: r.reason,
      }));
    } catch (err) {
      // 推荐失败不阻塞 · 让 reply_text 仍然展示
      console.error('[voice] recommend failed', err);
    }
  }

  const latencyMs = Date.now() - t0;

  // 记录 chat_log (跨会话历史)
  try {
    await logVoiceTurn(ctx, {
      userId,
      sessionId,
      turnIdx,
      transcript: voiceResult.transcript,
      replyText: voiceResult.replyText,
      scenario: voiceResult.recommendIntent ? 'selection' : 'casual',
      provider: voiceResult.provider,
      model: voiceResult.model,
      inputTokens: voiceResult.inputTokens,
      outputTokens: voiceResult.outputTokens,
      costUsdMicros: voiceResult.costUsdMicros,
      latencyMs,
    });
  } catch (err) {
    // 记录失败不阻塞用户体验
    console.error('[voice] logTurn failed', err);
  }

  return c.json({
    data: {
      transcript: voiceResult.transcript,
      reply_text: voiceResult.replyText,
      recommendations,
      session_id: sessionId,
      turn_idx: turnIdx + 1,
      latency_ms: latencyMs,
      provider: voiceResult.provider,
    },
  });
});

// ──────── v4 砍死 endpoints (2026-06-01 [[loverush_m03_audit_2026_06_01]]) ────────
// /recall-3 · /session/start · /session/finalize · /outreach/opt-out 4 个 endpoint
// 真数据证明 0 触发 · alpha 阶段死代码 · 410 Gone 返回 · 旧前端调用直接失败
// 路由保留是为了:① 旧 client 不崩(返 410 是 valid HTTP) ② 监控异常调用看是否有真用户
assistantRoutes.post('/recall-3', (c) => c.json({ error: { code: 'GONE', message: 'recall-3 已删除 · v4 砍' } }, 410));
assistantRoutes.post('/session/start', (c) => c.json({ error: { code: 'GONE', message: 'session/start 已删除 · v4 砍' } }, 410));
assistantRoutes.post('/session/finalize', (c) => c.json({ error: { code: 'GONE', message: 'session/finalize 已删除 · v4 砍' } }, 410));

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

// outreach/opt-out · alpha 阶段 outreach_state 0 行 · 0 主动 push 发出 · 无需 opt-out
// 标 410 但前端不再有调用入口 (assistant memory 页删了 opt-out 开关)
assistantRoutes.post('/outreach/opt-out', (c) => c.json({ error: { code: 'GONE', message: 'outreach 已停 · v4 砍' } }, 410));

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
