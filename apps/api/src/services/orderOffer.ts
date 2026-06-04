/**
 * 对话内下单卡 · order_offer · 编排服务
 *
 * runBookingOfferFlow：分身回复后，若客户在表达「下单意图」→ 在对话里推一张
 *   服务套餐卡（type=order_offer，contentOriginal 存 {therapistId,therapistName,tiers}）。
 *   客户在卡上点某个时长 → 前端跳确认付款页 /therapist/[id]/order?duration=X。
 *
 * 门槛（任意不过即不发，绝不强推）：
 *   1. intent —— detectBookingIntent 关键词命中客户最近一条消息
 *   2. cooldown —— 本会话距上一张 order_offer 须新增 >= cooldownMessages 条消息（防连发刷卡）
 *   3. tiers —— 技师有 basePriceJson 套餐（空套餐不发空卡）
 *
 * 红线（Tony 零推销感铁律）：只在客户「明确表达下单意图」时回应式推送，
 *   分身绝不在闲聊里主动塞下单卡。这是「回应需求」不是「推销」。
 *
 * 铁律：全部窄 select（抗并发 schema 漂移 42703）；全程 try/catch 降级不抛。
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { therapists, users, messages } from '@loverush/db';
import { sendMessage } from './chat';

export interface OrderOfferContext {
  db: Database;
}

export interface RunBookingOfferFlowArgs {
  conversationId: string;
  customerId: string;
  therapistUserId: string;
  /** 客户最近一条消息文本（关键词意图判定）；不传 → 不发（安全） */
  customerText?: string;
  /** 显式指定客户是否在要下单（测试/上层已判定时用）；不传则走 detectBookingIntent */
  wantBookingOverride?: boolean;
  /** 防连发：距上一张 order_offer 须新增 >= 此条数才再发 */
  cooldownMessages: number;
}

/**
 * 关键词判定客户是否在表达下单意图（避 LLM key 依赖，零外部调用）。
 * 聚焦明确下单词，刻意不含模糊的「发给我」（避免和「发张照片给我」的要图意图打架）。
 * 无 text → false（拿不到上下文绝不主动推卡）。
 */
export function detectBookingIntent(text?: string): boolean {
  if (!text) return false;
  return /下单|预约|怎么约|怎么订|怎么定|约你|想约|约一下|约个|怎么买|怎么付费|怎么收费|book|reserve|booking/i.test(
    text,
  );
}

/**
 * 防连发：本会话距上一张 order_offer 须新增 >= cooldownMessages 条消息才允许再发。
 * 从未发过 order_offer → 直接 true。
 */
async function bookingCooldownOk(
  db: Database,
  conversationId: string,
  cooldownMessages: number,
): Promise<boolean> {
  const lastRows = await db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'order_offer')))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const lastSentAt = lastRows[0]?.sentAt;
  if (!lastSentAt) return true;

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        gt(messages.sentAt, lastSentAt), // drizzle gt 正确处理 Date→timestamp(裸 sql 插 Date 会崩)
      ),
    );

  return (countRows[0]?.n ?? 0) >= cooldownMessages;
}

/**
 * 命中下单意图则推一张下单卡。返回是否真的发了卡（供上层决定本轮是否还跑别的主动行为）。
 * 门槛任意不过即 return false；全程不抛。
 */
export async function runBookingOfferFlow(
  ctx: OrderOfferContext,
  args: RunBookingOfferFlowArgs,
): Promise<boolean> {
  try {
    const want = args.wantBookingOverride ?? detectBookingIntent(args.customerText);
    if (!want) return false;

    if (!(await bookingCooldownOk(ctx.db, args.conversationId, args.cooldownMessages))) return false;

    // 取技师 id + 套餐（窄 select，抗漂移）
    const tRows = await ctx.db
      .select({ id: therapists.id, tiers: therapists.basePriceJson })
      .from(therapists)
      .where(eq(therapists.userId, args.therapistUserId))
      .limit(1);
    const t = tRows[0];
    if (!t || !Array.isArray(t.tiers) || t.tiers.length === 0) return false; // 空套餐 → 不发空卡

    const uRows = await ctx.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, args.therapistUserId))
      .limit(1);
    const therapistName = uRows[0]?.name ?? null;

    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: JSON.stringify({ therapistId: t.id, therapistName, tiers: t.tiers }),
      type: 'order_offer',
      isAiAlter: true,
    });
    return true;
  } catch (err) {
    console.warn(
      '[orderOffer] runBookingOfferFlow failed (降级不抛):',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
