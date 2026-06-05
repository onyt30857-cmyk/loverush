/**
 * 陪聊付费服务 · 核心
 *
 * 混合 freemium:每日免费额度(分身免费回复 N 条/天) → 软墙 → 陪聊时段(积分付费·纯倒计时)。
 *
 *   checkChatAccess：分身回复前判定——有进行中 session / 今日免费额度 → 放行;都没 → 软墙。
 *   consumeFreeQuota：分身用免费额度回了一条 → 计数 +1。
 *   startChatSession：买陪聊时段——扣客户积分 + 技师分成(70%) + 建 session(倒计时)。
 *   getActiveSession：查进行中时段(倒计时 UI 用)。
 *   maybeSendChatPaywall：额度用完发一张软墙卡(机会成本撒娇),带冷却防连发。
 *
 * 计费走 points.ts debit/credit(原子+幂等+流水),txnType 复用 CHAT_SPEND/CHAT_EARN,
 *   metadata.scene='chat_session' 区分来源。
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { chatQuotaUsage, chatSession, messages, therapists, users } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { credit, debit } from './points';
import { sendMessage } from './chat';

export interface ChatPassContext {
  db: Database;
}

/** 每日免费分身回复条数(每客户×技师,次日刷新) */
export const FREE_DAILY_QUOTA = 10;
/** 陪聊时段定价(分钟→积分) */
export const CHAT_PASS_PRICES: Record<number, number> = { 30: 500, 60: 900 };
/** 技师分成 70% */
export const CHAT_SHARE_BPS = 7000;
/** 软墙卡冷却:距上一张 chat_paywall 须新增 N 条消息才再发(避免每条都弹) */
const PAYWALL_COOLDOWN = 6;

/** UTC 当日 YYYY-MM-DD(v1 当 UTC) */
function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ChatAccess {
  allowed: boolean;
  source: 'session' | 'free' | 'none';
  remaining?: number;
  expireAt?: Date;
}

/** 分身回复前判定:有进行中 session > 今日免费额度 > 都没(软墙)。窄 select 抗漂移。 */
export async function checkChatAccess(
  ctx: ChatPassContext,
  args: { customerId: string; therapistUserId: string },
): Promise<ChatAccess> {
  const now = new Date();
  const sRows = await ctx.db
    .select({ expireAt: chatSession.expireAt })
    .from(chatSession)
    .where(
      and(
        eq(chatSession.customerId, args.customerId),
        eq(chatSession.therapistUserId, args.therapistUserId),
        gt(chatSession.expireAt, now),
      ),
    )
    .orderBy(desc(chatSession.expireAt))
    .limit(1);
  if (sRows[0]) return { allowed: true, source: 'session', expireAt: sRows[0].expireAt };

  const today = utcDate();
  const qRows = await ctx.db
    .select({ used: chatQuotaUsage.usedCount })
    .from(chatQuotaUsage)
    .where(
      and(
        eq(chatQuotaUsage.customerId, args.customerId),
        eq(chatQuotaUsage.therapistUserId, args.therapistUserId),
        eq(chatQuotaUsage.usageDate, today),
      ),
    )
    .limit(1);
  const used = qRows[0]?.used ?? 0;
  if (used < FREE_DAILY_QUOTA) return { allowed: true, source: 'free', remaining: FREE_DAILY_QUOTA - used };

  return { allowed: false, source: 'none' };
}

/** 免费额度回了一条 → 当日计数 +1(upsert) */
export async function consumeFreeQuota(
  ctx: ChatPassContext,
  args: { customerId: string; therapistUserId: string },
): Promise<void> {
  const today = utcDate();
  await ctx.db
    .insert(chatQuotaUsage)
    .values({ customerId: args.customerId, therapistUserId: args.therapistUserId, usageDate: today, usedCount: 1 })
    .onConflictDoUpdate({
      target: [chatQuotaUsage.customerId, chatQuotaUsage.therapistUserId, chatQuotaUsage.usageDate],
      // LEAST 封顶 FREE_DAILY_QUOTA：并发竞态下(两条同时读到 used<quota 都回复)计数也绝不超额度，
      // 不污染额度单一事实源。完全杜绝"并发多回一条"需把消费原子前移到回复前(改核心回复链,P2 暂不动)。
      set: { usedCount: sql`LEAST(${chatQuotaUsage.usedCount} + 1, ${FREE_DAILY_QUOTA})`, updatedAt: new Date() },
    });
}

/** 买陪聊时段:扣客户积分(余额不足 debit 抛 E2010) + 技师分成 + 建 session(倒计时) */
export async function startChatSession(
  ctx: ChatPassContext,
  args: { customerId: string; therapistUserId: string; durationMinutes: number; idempotencyKey?: string },
): Promise<{ id: string; expireAt: Date; durationMinutes: number }> {
  const price = CHAT_PASS_PRICES[args.durationMinutes];
  if (!price) throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '无效的陪聊时长');

  const baseKey = args.idempotencyKey
    ? `chatpass.${args.idempotencyKey}`
    : `chatpass.${args.customerId}.${args.therapistUserId}.${args.durationMinutes}.${Date.now()}`;

  await debit(
    { db: ctx.db },
    {
      userId: args.customerId,
      type: 'CHAT_SPEND',
      amount: price,
      description: `chat_session:${args.durationMinutes}min`,
      relatedUserId: args.therapistUserId,
      idempotencyKey: baseKey,
      metadata: { scene: 'chat_session', durationMinutes: args.durationMinutes },
    },
  );

  const share = Math.floor((price * CHAT_SHARE_BPS) / 10000);
  if (share > 0) {
    await credit(
      { db: ctx.db },
      {
        userId: args.therapistUserId,
        type: 'CHAT_EARN',
        amount: share,
        description: `chat_session:${args.durationMinutes}min`,
        relatedUserId: args.customerId,
        idempotencyKey: `${baseKey}.share`,
        metadata: { scene: 'chat_session', durationMinutes: args.durationMinutes },
      },
    );
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + args.durationMinutes * 60_000);
  const [row] = await ctx.db
    .insert(chatSession)
    .values({
      customerId: args.customerId,
      therapistUserId: args.therapistUserId,
      durationMinutes: args.durationMinutes,
      startAt: now,
      expireAt,
      status: 'active',
    })
    .returning({ id: chatSession.id, expireAt: chatSession.expireAt });
  return { id: row!.id, expireAt: row!.expireAt, durationMinutes: args.durationMinutes };
}

/** 查进行中时段(倒计时 UI) · 无则 null */
export async function getActiveSession(
  ctx: ChatPassContext,
  args: { customerId: string; therapistUserId: string },
): Promise<{ expireAt: Date } | null> {
  const now = new Date();
  const rows = await ctx.db
    .select({ expireAt: chatSession.expireAt })
    .from(chatSession)
    .where(
      and(
        eq(chatSession.customerId, args.customerId),
        eq(chatSession.therapistUserId, args.therapistUserId),
        gt(chatSession.expireAt, now),
      ),
    )
    .orderBy(desc(chatSession.expireAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 额度用完 → 发一张软墙卡(type=chat_paywall,机会成本撒娇)。冷却防连发:只在第一次用完时发,
 * 之后客户继续发消息分身静默不回(不重复弹卡),直到买时段 / 次日刷新。全程不抛。
 */
export async function maybeSendChatPaywall(
  ctx: ChatPassContext,
  args: { conversationId: string; therapistUserId: string },
): Promise<void> {
  try {
    const lastRows = await ctx.db
      .select({ sentAt: messages.sentAt })
      .from(messages)
      .where(and(eq(messages.conversationId, args.conversationId), eq(messages.type, 'chat_paywall')))
      .orderBy(desc(messages.sentAt))
      .limit(1);
    if (lastRows[0]) {
      const cntRows = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.conversationId, args.conversationId), gt(messages.sentAt, lastRows[0].sentAt)));
      if ((cntRows[0]?.n ?? 0) < PAYWALL_COOLDOWN) return; // 冷却内不重发
    }

    const tRows = await ctx.db
      .select({ id: therapists.id })
      .from(therapists)
      .where(eq(therapists.userId, args.therapistUserId))
      .limit(1);
    if (!tRows[0]) return;
    const uRows = await ctx.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, args.therapistUserId))
      .limit(1);

    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: JSON.stringify({
        therapistId: tRows[0].id,
        therapistName: uRows[0]?.name ?? null,
        options: [
          { minutes: 30, points: CHAT_PASS_PRICES[30] },
          { minutes: 60, points: CHAT_PASS_PRICES[60] },
        ],
      }),
      type: 'chat_paywall',
      isAiAlter: true,
    });
  } catch (err) {
    console.warn('[chatPass] maybeSendChatPaywall failed:', err instanceof Error ? err.message : err);
  }
}
