/**
 * 对话内礼物卡 · gift_hint · 编排服务
 *
 * runGiftHintFlow：分身回复后,若客户正处情绪峰值(刚夸她/聊得开心)且关系够熟 →
 *   系统在对话里浮一张「礼物时机卡」(分身不硬开口,卡片承接)。客户点卡 → 打开礼物面板送礼。
 *
 * 门槛(任意不过即不浮,绝不强弹):
 *   1. moment —— detectGiftMoment 命中正面情绪信号 且 不含负面信号(难过/吐槽时绝不弹)
 *   2. intimacy —— 亲密度 >= GIFT_HINT_MIN_LEVEL(新客不弹,动量不足时弹显廉价)
 *   3. cooldown —— 本会话距上一张 gift_hint 须新增 >= GIFT_HINT_COOLDOWN 条消息(礼物比图敏感,冷却更长)
 *
 * 红线(Tony 零推销):只在客户给完情绪价值的峰值后回应式浮,且只是个轻入口、可不点。
 *   分身嘴里的娇嗔由 prompt 负责;这里只负责"在对的时机把入口递到手边"。
 *
 * 铁律:窄 select 抗漂移;全程 try/catch 降级不抛。
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { therapists, users, messages, customerRelationshipProfile } from '@loverush/db';
import { sendMessage } from './chat';
import { getIntimacy } from './companion';

export interface GiftHintContext {
  db: Database;
}

export interface RunGiftHintFlowArgs {
  conversationId: string;
  customerId: string;
  therapistUserId: string;
  /** 客户最近一条消息文本(情绪信号判定);不传 → 不浮(安全) */
  customerText?: string;
  /** 显式指定是否处情绪峰值(测试用) */
  wantGiftMomentOverride?: boolean;
}

/** 亲密度门槛:Lv1「熟悉」起才浮(Lv0 新客不弹) */
export const GIFT_HINT_MIN_LEVEL = 1;
/** 防连发:距上一张 gift_hint 须新增多少条消息(比发图 4 更克制) */
export const GIFT_HINT_COOLDOWN = 8;
/**
 * 余晖期:客户刚送礼后,这段时间内分身不浮礼物卡(只回报+升温,绝不马上索要)。
 * 根治「刚送完又索要 = 贩卖机感」。
 */
export const GIFT_AFTERGLOW_MINUTES = 5;

/**
 * 由头库(P1 · 由头轮换防复读)。
 * 每次浮礼物卡时,从与 lastGiftHintKind 不同的类型里选一个,
 * 同时写回 relationship.lastGiftHintKind,确保下次换角度。
 * prompt 层也注入"上次用了 X 由头,这次换个角度"，让文字层一并轮换。
 */
export const GIFT_HINT_KINDS = ['joke', 'emotion', 'exclusive', 'nurture', 'anniversary'] as const;
export type GiftHintKind = (typeof GIFT_HINT_KINDS)[number];

/** 从现有 kind 列表里挑一个与 last 不同的(轮换)；若 last 为 null 则随机挑 */
export function pickNextGiftHintKind(last: string | null | undefined): GiftHintKind {
  const pool = last
    ? GIFT_HINT_KINDS.filter((k) => k !== last)
    : [...GIFT_HINT_KINDS];
  // 若 last 恰好不在枚举内（旧数据/脏值），全量池兜底
  const safe = pool.length > 0 ? pool : [...GIFT_HINT_KINDS];
  return safe[Math.floor(Math.random() * safe.length)]!;
}

/**
 * 情绪峰值判定:客户最近消息含正面情绪信号(夸她/开心/亲昵)且不含负面信号。
 * 难过/吐槽/压力时绝不弹(那一刻只给陪伴)。无 text → false。
 */
const POSITIVE = /喜欢你|好喜欢|想你|想见你|可爱|漂亮|好看|好美|谢谢|开心|哈哈|嘻嘻|宝贝|亲爱|乖|懂我|温柔|好甜|爱你|抱抱|么么|亲亲|喜欢和你|聊得来|舍不得/i;
const NEGATIVE = /难过|难受|累|烦|压力|不开心|生气|吵架|分手|失业|没钱|很穷|忙死|郁闷|伤心|想哭|崩溃|焦虑|抑郁|烦躁|心情不好|不想说|别烦/i;

export function detectGiftMoment(text?: string): boolean {
  if (!text) return false;
  if (NEGATIVE.test(text)) return false; // 负面情绪一票否决
  return POSITIVE.test(text);
}

/** 防连发:本会话距上一张 gift_hint 须新增 >= cooldown 条消息才允许再浮。从未浮过 → true。 */
async function giftHintCooldownOk(db: Database, conversationId: string): Promise<boolean> {
  const lastRows = await db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'gift_hint')))
    .orderBy(desc(messages.sentAt))
    .limit(1);

  const lastSentAt = lastRows[0]?.sentAt;
  if (!lastSentAt) return true;

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gt(messages.sentAt, lastSentAt)));

  return (countRows[0]?.n ?? 0) >= GIFT_HINT_COOLDOWN;
}

/**
 * 情绪峰值 + 关系够熟 + 冷却到 → 浮一张礼物卡。返回是否浮了卡(供上层收尾)。
 * 门槛任意不过即 return false;全程不抛。
 */
export async function runGiftHintFlow(
  ctx: GiftHintContext,
  args: RunGiftHintFlowArgs,
): Promise<boolean> {
  try {
    const moment = args.wantGiftMomentOverride ?? detectGiftMoment(args.customerText);
    if (!moment) return false;

    // ── 余晖期闸(P0 核心)──
    // 客户刚送礼后 GIFT_AFTERGLOW_MINUTES 分钟内绝不再浮礼物卡:「刚收礼只回报,别开口索要」。
    // 优先读 customerRelationshipProfile.lastGiftReceivedAt;
    // 若关系行不存在(新客从未送礼)则 fallback 查对话最近 gift 消息。
    const afterglowCutoff = new Date(Date.now() - GIFT_AFTERGLOW_MINUTES * 60_000);
    let lastGiftAt: Date | null = null;

    // 查 therapistId(therapists.id) → 读 relationship
    const tRows = await ctx.db
      .select({ id: therapists.id })
      .from(therapists)
      .where(eq(therapists.userId, args.therapistUserId))
      .limit(1);
    const therapistId = tRows[0]?.id;
    if (therapistId) {
      const relRows = await ctx.db
        .select({ lastGiftReceivedAt: customerRelationshipProfile.lastGiftReceivedAt })
        .from(customerRelationshipProfile)
        .where(
          and(
            eq(customerRelationshipProfile.customerId, args.customerId),
            eq(customerRelationshipProfile.therapistId, therapistId),
          ),
        )
        .limit(1);
      lastGiftAt = relRows[0]?.lastGiftReceivedAt ?? null;
    }

    // fallback:relationship 无记录时，从消息表查最近一条 gift 消息（送礼客户身份）
    if (!lastGiftAt) {
      const giftMsgRows = await ctx.db
        .select({ sentAt: messages.sentAt })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, args.conversationId),
            eq(messages.type, 'gift'),
            eq(messages.senderUserId, args.customerId),
          ),
        )
        .orderBy(desc(messages.sentAt))
        .limit(1);
      lastGiftAt = giftMsgRows[0]?.sentAt ?? null;
    }

    if (lastGiftAt && lastGiftAt > afterglowCutoff) {
      // 余晖期内：客户刚送礼，分身只回报不索要
      return false;
    }

    const { level } = await getIntimacy(ctx, {
      customerId: args.customerId,
      therapistUserId: args.therapistUserId,
    });
    if (level < GIFT_HINT_MIN_LEVEL) return false; // 新客不弹

    if (!(await giftHintCooldownOk(ctx.db, args.conversationId))) return false;

    // 技师 id(GiftSheet 用 therapist.id) + 昵称。窄 select 抗漂移。
    // therapistId 已在余晖期查询阶段取得，复用即可（避免重复查询）。
    if (!therapistId) return false;

    const uRows = await ctx.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, args.therapistUserId))
      .limit(1);

    // P1 · 由头轮换：读上次由头 → 选不同的类型 → 写回 relationship，防复读。
    // 先读，已有 therapistId 直接查；读不到不阻断(kind 仍随机取)。
    let lastKind: string | null = null;
    try {
      const relRows = await ctx.db
        .select({ lastGiftHintKind: customerRelationshipProfile.lastGiftHintKind })
        .from(customerRelationshipProfile)
        .where(
          and(
            eq(customerRelationshipProfile.customerId, args.customerId),
            eq(customerRelationshipProfile.therapistId, therapistId),
          ),
        )
        .limit(1);
      lastKind = relRows[0]?.lastGiftHintKind ?? null;
    } catch { /* 读不到继续 */ }

    const nextKind = pickNextGiftHintKind(lastKind);

    // 写回 lastGiftHintKind（upsert，不阻断主链）
    try {
      const now = new Date();
      await ctx.db
        .insert(customerRelationshipProfile)
        .values({ customerId: args.customerId, therapistId, lastGiftHintKind: nextKind })
        .onConflictDoUpdate({
          target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
          set: { lastGiftHintKind: nextKind, updatedAt: now },
        });
    } catch (err) {
      console.warn('[giftHint] write lastGiftHintKind failed (降级不抛):', (err as Error)?.message);
    }

    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: JSON.stringify({ therapistId, therapistName: uRows[0]?.name ?? null, hintKind: nextKind }),
      type: 'gift_hint',
      isAiAlter: true,
    });
    return true;
  } catch (err) {
    console.warn('[giftHint] runGiftHintFlow failed (降级不抛):', err instanceof Error ? err.message : err);
    return false;
  }
}
