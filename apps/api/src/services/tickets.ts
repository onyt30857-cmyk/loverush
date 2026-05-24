/**
 * 客服仲裁 · M12
 *
 * 工单生命周期：
 *   open → triage (AI 分类) → assigned → waiting_user / in_review → resolved → closed
 *   异常：escalated
 *
 * AI 分类（v5 政策：客户端不显示 AI 字样，对外统一"客服小助手"）：
 *   工单创建后异步调 LLM 分类 + 生成摘要 + 设置优先级
 *
 * 仲裁动作（resolveTicket）：refund / warn / suspend / ban / dismiss
 *   refund → 给报告人退积分（从被报告人扣 · 通过 points.transfer）
 *   warn → 写风控事件
 *   suspend / ban → 改 users.status
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  Database,
  tickets,
  ticketMessages,
  users,
  type Ticket,
  type TicketMessage,
} from '@loverush/db';
import {
  createLLMGateway,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type LLMGateway,
} from '@loverush/llm';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { loadEnv } from '../env';
import { credit, debit, type PointsContext } from './points';
import { recordRiskEvent, type RiskContext } from './risk';
import { fireAndForget } from './logger';

export interface TicketContext {
  db: Database;
}

let gw: LLMGateway | null = null;
function gateway(): LLMGateway {
  if (gw) return gw;
  const env = loadEnv();
  gw = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    } as Parameters<typeof createLLMGateway>[0]['providers'],
  });
  return gw;
}

// ──────────────── 工单创建 ────────────────

const CATEGORIES = [
  'refund_request',
  'harassment',
  'fraud',
  'kyc_dispute',
  'tech_issue',
  'other',
] as const;
type Category = (typeof CATEGORIES)[number];

function genTicketNo(): string {
  const d = new Date();
  const yyyymmdd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `TK${yyyymmdd}${nanoid(6).toUpperCase()}`;
}

export interface CreateTicketArgs {
  reporterUserId: string;
  title: string;
  description: string;
  targetUserId?: string;
  relatedOrderId?: string;
  evidence?: Record<string, unknown>;
}

export async function createTicket(ctx: TicketContext, args: CreateTicketArgs): Promise<Ticket> {
  const [row] = await ctx.db
    .insert(tickets)
    .values({
      ticketNo: genTicketNo(),
      reporterUserId: args.reporterUserId,
      targetUserId: args.targetUserId,
      relatedOrderId: args.relatedOrderId,
      title: args.title,
      description: args.description,
      category: 'other',
      status: 'open',
      evidence: args.evidence ?? {},
      slaDeadlineAt: new Date(Date.now() + 24 * 3600 * 1000),
    })
    .returning();
  if (!row) throw HttpError.internal('ticket insert failed');

  await ctx.db.insert(ticketMessages).values({
    ticketId: row.id,
    senderUserId: args.reporterUserId,
    senderRole: 'reporter',
    content: args.description,
  });

  // 异步 AI 分类
  fireAndForget(aiTriage(ctx, row.id), 'tickets.ai_triage_failed', { ticketId: row.id });

  return row;
}

async function aiTriage(ctx: TicketContext, ticketId: string): Promise<void> {
  const t = await ctx.db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
  if (!t) return;

  const prompt = `请把以下用户投诉分类，并给一句摘要。

候选分类（必须二选一）：${CATEGORIES.join(' / ')}
紧急度：0-100 整数（涉资金安全 / 人身安全 = 90+，普通申诉 = 50，咨询 = 20）

严格输出 JSON：
{"category": "...", "priority": 0-100, "summary": "..."}

标题：${t.title}
描述：${t.description}`;

  const res = await gateway().complete({
    tier: 'T2',
    system: '你是客服初判 AI。严格按 JSON 输出，不加解释。',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 200,
    temperature: 0,
    tag: 'ticket.triage',
  });

  let parsed: { category: string; priority: number; summary: string };
  try {
    parsed = JSON.parse(res.content.trim());
  } catch {
    return;
  }

  const category = (CATEGORIES as readonly string[]).includes(parsed.category)
    ? (parsed.category as Category)
    : 'other';

  await ctx.db
    .update(tickets)
    .set({
      category,
      priority: Math.min(100, Math.max(0, parsed.priority ?? 50)),
      aiCategoryConfidence: 80,
      aiSummary: parsed.summary?.slice(0, 200),
      status: 'triage',
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticketId));
}

// ──────────────── 沟通 ────────────────

export async function reply(
  ctx: TicketContext,
  args: { ticketId: string; senderUserId: string; senderRole: 'reporter' | 'target' | 'cs_human' | 'admin'; content: string; isInternal?: boolean },
): Promise<TicketMessage> {
  const t = await ctx.db.query.tickets.findFirst({ where: eq(tickets.id, args.ticketId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'ticket not found');
  if (['closed', 'resolved'].includes(t.status) && !args.isInternal) {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, `ticket ${t.status}`);
  }

  const [msg] = await ctx.db
    .insert(ticketMessages)
    .values({
      ticketId: args.ticketId,
      senderUserId: args.senderUserId,
      senderRole: args.senderRole,
      content: args.content,
      isInternal: args.isInternal ? 1 : 0,
    })
    .returning();

  await ctx.db
    .update(tickets)
    .set({
      status: args.senderRole === 'reporter' ? 'in_review' : 'waiting_user',
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, args.ticketId));

  return msg!;
}

// ──────────────── 指派 ────────────────

export async function assign(
  ctx: TicketContext,
  args: { ticketId: string; assigneeUserId: string },
): Promise<Ticket> {
  const [row] = await ctx.db
    .update(tickets)
    .set({ assigneeUserId: args.assigneeUserId, assignedAt: new Date(), status: 'assigned', updatedAt: new Date() })
    .where(eq(tickets.id, args.ticketId))
    .returning();
  if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'ticket not found');
  return row;
}

// ──────────────── 裁决 ────────────────

export interface ResolveArgs {
  ticketId: string;
  adminUserId: string;
  resolutionType: 'refund' | 'warn_target' | 'suspend_target' | 'ban_target' | 'dismiss' | 'no_action';
  resolutionNote: string;
  refundPoints?: number;
  suspendDays?: number;
}

export async function resolve(ctx: TicketContext, args: ResolveArgs): Promise<Ticket> {
  const t = await ctx.db.query.tickets.findFirst({ where: eq(tickets.id, args.ticketId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'ticket not found');
  if (t.status === 'closed') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, 'ticket already closed');
  }

  // 执行副作用
  if (args.resolutionType === 'refund' && args.refundPoints && args.refundPoints > 0) {
    if (!t.targetUserId) {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'cannot refund without target');
    }
    await debit({ db: ctx.db } as PointsContext, {
      userId: t.targetUserId,
      type: 'REFUND',
      amount: args.refundPoints,
      description: `工单 ${t.ticketNo} 裁决退款`,
      relatedUserId: t.reporterUserId,
      idempotencyKey: `ticket.refund.${t.id}.out`,
    });
    await credit({ db: ctx.db } as PointsContext, {
      userId: t.reporterUserId,
      type: 'REFUND',
      amount: args.refundPoints,
      description: `工单 ${t.ticketNo} 收到退款`,
      relatedUserId: t.targetUserId,
      idempotencyKey: `ticket.refund.${t.id}.in`,
    });
  }

  if (args.resolutionType === 'warn_target' && t.targetUserId) {
    await recordRiskEvent({ db: ctx.db } as RiskContext, {
      subjectUserId: t.targetUserId,
      subjectType: 'user',
      eventType: 'ticket_warning',
      severity: 50,
      payload: { ticketId: t.id, note: args.resolutionNote },
    });
  }

  if ((args.resolutionType === 'suspend_target' || args.resolutionType === 'ban_target') && t.targetUserId) {
    await ctx.db
      .update(users)
      .set({
        status: args.resolutionType === 'ban_target' ? 'banned' : 'suspended',
        bannedAt: args.resolutionType === 'ban_target' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, t.targetUserId));
    await recordRiskEvent({ db: ctx.db } as RiskContext, {
      subjectUserId: t.targetUserId,
      subjectType: 'user',
      eventType: args.resolutionType === 'ban_target' ? 'admin_ban' : 'admin_suspend',
      severity: 90,
      payload: { ticketId: t.id, suspendDays: args.suspendDays, note: args.resolutionNote },
    });
  }

  const [row] = await ctx.db
    .update(tickets)
    .set({
      status: 'resolved',
      resolutionType: args.resolutionType,
      resolutionNote: args.resolutionNote,
      refundPoints: args.refundPoints,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, args.ticketId))
    .returning();
  return row!;
}

// ──────────────── 查询 ────────────────

export async function listMyTickets(
  ctx: TicketContext,
  args: { userId: string; limit?: number; offset?: number },
): Promise<Ticket[]> {
  return ctx.db.query.tickets.findMany({
    where: eq(tickets.reporterUserId, args.userId),
    orderBy: [desc(tickets.openedAt)],
    limit: args.limit ?? 30,
    offset: args.offset ?? 0,
  });
}

export async function listAdminQueue(
  ctx: TicketContext,
  args: { status?: string; category?: string; limit?: number; offset?: number },
): Promise<Ticket[]> {
  const conds = [];
  if (args.status) conds.push(eq(tickets.status, args.status));
  if (args.category) conds.push(eq(tickets.category, args.category));
  return ctx.db.query.tickets.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(tickets.priority), desc(tickets.openedAt)],
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  });
}

export async function listMessages(ctx: TicketContext, ticketId: string): Promise<TicketMessage[]> {
  return ctx.db.query.ticketMessages.findMany({
    where: eq(ticketMessages.ticketId, ticketId),
    orderBy: [ticketMessages.createdAt],
  });
}
