/**
 * AI 助理会话回放 · admin
 *
 * GET /admin/assistant/sessions                列表(按客户 / 时间 / cost / filter 倍数筛选)
 * GET /admin/assistant/sessions/turns          单次拉某用户/某 session 的所有 turn
 * GET /admin/assistant/sessions/turns/:logId   单 turn 详情(完整 prompt / raw / metadata)
 *
 * 权限:admin / cs / auditor 可读;ops 仅 metadata(在响应里剥 prompt/raw/content)
 * 审计:每次访问写 admin_audit_log(由 middleware 统一处理)
 *
 * 数据源:packages/db/src/schema/assistant_chat_log.ts
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { assistantChatLog, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

// ── Query schema
const ListQuery = z.object({
  user_id: z.string().uuid().optional(),       // 按客户 ID 精确筛
  scenario: z.string().max(40).optional(),     // casual / selection / ...
  min_filter_attempts: z.coerce.number().int().min(1).max(10).optional(), // 找 Bad case
  since: z.string().datetime().optional(),     // ISO timestamp
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  // 排序:created_at desc(默认) / cost desc / latency desc / attempts desc
  sort: z.enum(['ts', 'cost', 'latency', 'attempts']).optional(),
});

const TurnsQuery = z.object({
  user_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).refine((v) => v.user_id || v.session_id, {
  message: 'either user_id or session_id required',
});

export const adminAssistantSessionRoutes = new Hono();
adminAssistantSessionRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'auditor', 'ops']));

/** 是否暴露敏感字段(prompt / raw / final_content / userInputRaw) */
function canSeeContent(roles: string[]): boolean {
  // ops 不可见对话内容,只看 metadata 做容量/成本分析
  return roles.some((r) => r === 'admin' || r === 'cs' || r === 'auditor');
}

// ──────────────── GET / · 列表 ────────────────
adminAssistantSessionRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const db = getDb();
  const roles = c.get('userRoles' as never) as string[] | undefined;
  const showContent = canSeeContent(roles ?? []);

  const conds = [];
  if (q.user_id) conds.push(eq(assistantChatLog.userId, q.user_id));
  if (q.scenario) conds.push(eq(assistantChatLog.scenario, q.scenario));
  if (q.min_filter_attempts) conds.push(gte(assistantChatLog.filterAttempts, q.min_filter_attempts));
  if (q.since) conds.push(gte(assistantChatLog.createdAt, new Date(q.since)));
  if (q.until) conds.push(lte(assistantChatLog.createdAt, new Date(q.until)));

  const orderCol =
    q.sort === 'cost' ? assistantChatLog.costUsdMicros
    : q.sort === 'latency' ? assistantChatLog.latencyMs
    : q.sort === 'attempts' ? assistantChatLog.filterAttempts
    : assistantChatLog.createdAt;

  const list = await db
    .select({
      id: assistantChatLog.id,
      userId: assistantChatLog.userId,
      sessionId: assistantChatLog.sessionId,
      turnIdx: assistantChatLog.turnIdx,
      scenario: assistantChatLog.scenario,
      jokeLevel: assistantChatLog.jokeLevel,
      locale: assistantChatLog.locale,
      llmProvider: assistantChatLog.llmProvider,
      llmModel: assistantChatLog.llmModel,
      inputTokens: assistantChatLog.inputTokens,
      outputTokens: assistantChatLog.outputTokens,
      costUsdMicros: assistantChatLog.costUsdMicros,
      filterAttempts: assistantChatLog.filterAttempts,
      latencyMs: assistantChatLog.latencyMs,
      createdAt: assistantChatLog.createdAt,
      // 仅可见角色:回看片段(头 60 字预览)
      userInputPreview: showContent ? sql<string>`substring(${assistantChatLog.userInput}, 1, 60)` : sql<null>`NULL`,
      finalContentPreview: showContent ? sql<string>`substring(${assistantChatLog.finalContent}, 1, 60)` : sql<null>`NULL`,
    })
    .from(assistantChatLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orderCol))
    .limit(q.limit ?? 50)
    .offset(q.offset ?? 0);

  return c.json({ data: list, meta: { contentMasked: !showContent } });
});

// ──────────────── GET /turns · 拉某用户/session 全部 turns ────────────────
adminAssistantSessionRoutes.get('/turns', zValidator('query', TurnsQuery), async (c) => {
  const q = c.req.valid('query');
  const db = getDb();
  const roles = c.get('userRoles' as never) as string[] | undefined;
  const showContent = canSeeContent(roles ?? []);

  const conds = [];
  if (q.user_id) conds.push(eq(assistantChatLog.userId, q.user_id));
  if (q.session_id) conds.push(eq(assistantChatLog.sessionId, q.session_id));

  const turns = await db.query.assistantChatLog.findMany({
    where: and(...conds),
    orderBy: [desc(assistantChatLog.createdAt)],
    limit: q.limit ?? 100,
  });

  // 排序后正向(便于时间轴展示)
  const ordered = turns.reverse();

  const cleaned = ordered.map((t) => ({
    id: t.id,
    userId: t.userId,
    sessionId: t.sessionId,
    turnIdx: t.turnIdx,
    scenario: t.scenario,
    jokeLevel: t.jokeLevel,
    seriousMode: t.seriousMode,
    locale: t.locale,
    llmProvider: t.llmProvider,
    llmModel: t.llmModel,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    costUsdMicros: t.costUsdMicros,
    filterAttempts: t.filterAttempts,
    filterFinalSoftScore: t.filterFinalSoftScore,
    filterFinalHardHits: t.filterFinalHardHits,
    latencyMs: t.latencyMs,
    createdAt: t.createdAt,
    // 仅可见角色:完整内容
    userInput: showContent ? t.userInput : null,
    userInputRaw: showContent ? t.userInputRaw : null,
    memorySnippet: showContent ? t.memorySnippet : null,
    systemPrompt: showContent ? t.systemPrompt : null,
    llmRawOutput: showContent ? t.llmRawOutput : null,
    finalContent: showContent ? t.finalContent : null,
  }));

  return c.json({ data: cleaned, meta: { contentMasked: !showContent, count: cleaned.length } });
});

// ──────────────── GET /turns/:id · 单 turn 详情 ────────────────
adminAssistantSessionRoutes.get('/turns/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const roles = c.get('userRoles' as never) as string[] | undefined;
  const showContent = canSeeContent(roles ?? []);

  const turn = await db.query.assistantChatLog.findFirst({
    where: eq(assistantChatLog.id, id),
  });
  if (!turn) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'chat log not found');

  // 关联用户基本信息
  const u = await db.query.users.findFirst({
    where: eq(users.id, turn.userId),
    columns: { id: true, displayName: true, userType: true, locale: true, createdAt: true },
  });

  return c.json({
    data: {
      ...turn,
      userInput: showContent ? turn.userInput : null,
      userInputRaw: showContent ? turn.userInputRaw : null,
      memorySnippet: showContent ? turn.memorySnippet : null,
      systemPrompt: showContent ? turn.systemPrompt : null,
      llmRawOutput: showContent ? turn.llmRawOutput : null,
      finalContent: showContent ? turn.finalContent : null,
      user: u ?? null,
    },
    meta: { contentMasked: !showContent },
  });
});
