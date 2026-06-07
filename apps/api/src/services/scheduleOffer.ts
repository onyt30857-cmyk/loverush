/**
 * 对话内选时段卡 · schedule_offer · 编排服务
 *
 * runScheduleOfferFlow：分身回复后,若客户在问档期/约时间 → 推一张真实可约时段卡
 *   (点排班引擎 computeAvailability 算出来的空档)。客户点某个时段 → 前端跳确认下单页、
 *   时间已预选(/therapist/[id]/order?date=&startAt=&duration=)。
 *
 * 门槛(任意不过即不发,绝不强推):
 *   1. intent —— detectScheduleIntent 命中客户最近一条消息
 *   2. cooldown —— 本会话距上一张 schedule_offer 须新增 >= cooldownMessages 条消息
 *   3. slots —— 今天/明天至少有一个真实可约空档(全满则不发空卡,分身文字答即可)
 *
 * 红线(Tony 零推销):只在客户「明确问档期/约时间」时回应式推,分身绝不闲聊主动塞。
 *   这是「报真实档期+收口下单」的混合档期闭环([[loverush_m06_facts_guardrail]]),非推销。
 *
 * 铁律:窄 select 抗漂移;全程 try/catch 降级不抛。
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database, Message } from '@loverush/db';
import { therapists, messages } from '@loverush/db';
import { sendMessage } from './chat';
import { computeAvailability } from './availability';

export interface ScheduleOfferContext {
  db: Database;
}

export interface RunScheduleOfferFlowArgs {
  conversationId: string;
  customerId: string;
  therapistUserId: string;
  /** 客户最近一条消息文本(关键词意图判定);不传 → 不发(安全) */
  customerText?: string;
  /** 显式指定客户是否在问档期(测试/上层已判定时用) */
  wantScheduleOverride?: boolean;
  /** 防连发:距上一张 schedule_offer 须新增 >= 此条数才再发 */
  cooldownMessages: number;
}

/**
 * 关键词判定客户是否在问档期/约时间(避 LLM key 依赖,零外部调用)。
 * 无 text → false(拿不到上下文绝不主动推卡)。
 */
export function detectScheduleIntent(text?: string): boolean {
  if (!text) return false;
  return /几点|什么时候|啥时候|几号|档期|有没有空|有空吗|有空么|能约吗|能约么|约几点|什么时间|哪天|约时间|预约时间|今晚.*行|明天.*行|今天.*行/i.test(
    text,
  );
}

/**
 * 防连发:本会话距上一张 schedule_offer 须新增 >= cooldownMessages 条消息才允许再发。
 * 从未发过 → 直接 true。
 */
async function scheduleCooldownOk(
  db: Database,
  conversationId: string,
  cooldownMessages: number,
): Promise<boolean> {
  const lastRows = await db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'schedule_offer')))
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

/** UTC 日期串 YYYY-MM-DD(v1 当 UTC,同 availability 引擎口径) */
function utcDateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * 命中问档期意图则推一张可约时段卡。返回是否真的发了卡(供上层决定本轮是否还跑别的)。
 * 门槛任意不过即 return false;全程不抛。
 */
export async function runScheduleOfferFlow(
  ctx: ScheduleOfferContext,
  args: RunScheduleOfferFlowArgs,
): Promise<boolean> {
  try {
    const want = args.wantScheduleOverride ?? detectScheduleIntent(args.customerText);
    if (!want) return false;

    if (!(await scheduleCooldownOk(ctx.db, args.conversationId, args.cooldownMessages))) return false;

    // 技师 id + 套餐(取首套餐时长当默认算空档,无则 60)。窄 select 抗漂移。
    const tRows = await ctx.db
      .select({ id: therapists.id, tiers: therapists.basePriceJson })
      .from(therapists)
      .where(eq(therapists.userId, args.therapistUserId))
      .limit(1);
    const t = tRows[0];
    if (!t) return false;
    const durationMinutes =
      (Array.isArray(t.tiers) && (t.tiers[0]?.duration as number | undefined)) || 60;

    // 今天没空档试明天;两天都满/无排班 → 不发(分身文字答即可)
    for (const offset of [0, 1]) {
      const date = utcDateStr(offset);
      const slots = await computeAvailability(ctx.db, {
        therapistUserId: args.therapistUserId,
        date,
        durationMinutes,
      });
      const avail = slots.filter((s) => s.available);
      if (avail.length === 0) continue;

      await sendMessage(ctx, {
        conversationId: args.conversationId,
        senderUserId: args.therapistUserId,
        text: JSON.stringify({
          therapistId: t.id,
          durationMinutes,
          date,
          slots: avail.slice(0, 8).map((s) => ({ startAt: s.startAt, endAt: s.endAt })),
        }),
        type: 'schedule_offer',
        isAiAlter: true,
      });
      return true;
    }
    return false;
  } catch (err) {
    console.warn(
      '[scheduleOffer] runScheduleOfferFlow failed (降级不抛):',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * 技师手动发"可约时段"卡(B2)· 复用 runScheduleOfferFlow 的档期计算,但:
 *  - 绕过"客户在问"意图门 + 冷却(技师主动决定发),
 *  - isAiAlter=false(真技师发,非分身),
 *  - 返回发出的 message(供前端即时插入),今明两天全满 → {sent:false}。
 */
export async function sendScheduleOfferManual(
  ctx: ScheduleOfferContext,
  args: { conversationId: string; therapistUserId: string },
): Promise<{ sent: boolean; message?: Message }> {
  const tRows = await ctx.db
    .select({ id: therapists.id, tiers: therapists.basePriceJson })
    .from(therapists)
    .where(eq(therapists.userId, args.therapistUserId))
    .limit(1);
  const t = tRows[0];
  if (!t) return { sent: false };
  const durationMinutes = (Array.isArray(t.tiers) && (t.tiers[0]?.duration as number | undefined)) || 60;

  for (const offset of [0, 1]) {
    const date = utcDateStr(offset);
    const slots = await computeAvailability(ctx.db, {
      therapistUserId: args.therapistUserId,
      date,
      durationMinutes,
    });
    const avail = slots.filter((s) => s.available);
    if (avail.length === 0) continue;

    const message = await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: JSON.stringify({
        therapistId: t.id,
        durationMinutes,
        date,
        slots: avail.slice(0, 8).map((s) => ({ startAt: s.startAt, endAt: s.endAt })),
      }),
      type: 'schedule_offer',
      isAiAlter: false,
    });
    return { sent: true, message };
  }
  return { sent: false };
}
