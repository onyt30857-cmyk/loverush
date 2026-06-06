/**
 * M18 撩拨发图 · 挑图核心 service
 *
 * pickFreshMedia：为(技师→客户)挑一张"没发过 + 够亲密度 + tier 命中"的图
 *   - 防重：排除 chat_media_sends 已记录的 media_id（一图对一客户只发一次）
 *   - 加权随机：power(random(), 1/weight) DESC，weight 越大越容易被选中
 * recordMediaSend：写入发送记录（防重核心），onConflictDoNothing 幂等
 * imageCooldownOk：防连发，距上一次发图后须新增 >= cooldownMessages 条对话消息
 *
 * 铁律：全部窄 select（.select({...}).from()），绝不用 db.query.X.findFirst 选全表
 *       （多会话共享 checkout，therapists 等表有未迁移并发列，选全表会 42703）
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { chatMedia, chatMediaSends, messages } from '@loverush/db';

export interface ChatMediaContext {
  db: Database;
}

export interface PickFreshMediaArgs {
  therapistUserId: string;
  customerId: string;
  intimacyLevel: number;
  tiers: string[];
}

export interface FreshMedia {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  tier: string;
  pricePoints: number;
  intimacyMin: number;
}

/**
 * 挑一张"够新鲜"的图（没发过 + 亲密度门槛 + tier 命中），加权随机取一张。
 * 无可选时返回 null。
 */
export async function pickFreshMedia(
  ctx: ChatMediaContext,
  { therapistUserId, customerId, intimacyLevel, tiers }: PickFreshMediaArgs,
): Promise<FreshMedia | null> {
  const { db } = ctx;
  if (tiers.length === 0) return null;

  const tierList = sql.join(
    tiers.map((t) => sql`${t}`),
    sql`, `,
  );

  const rows = await db
    .select({
      id: chatMedia.id,
      url: chatMedia.url,
      thumbnailUrl: chatMedia.thumbnailUrl,
      tier: chatMedia.tier,
      pricePoints: chatMedia.pricePoints,
      intimacyMin: chatMedia.intimacyMin,
    })
    .from(chatMedia)
    .where(
      and(
        eq(chatMedia.therapistUserId, therapistUserId),
        eq(chatMedia.isActive, 1),
        sql`${chatMedia.intimacyMin} <= ${intimacyLevel}`,
        sql`${chatMedia.tier} IN (${tierList})`,
        sql`${chatMedia.id} NOT IN (
          SELECT ${chatMediaSends.mediaId} FROM ${chatMediaSends}
          WHERE ${chatMediaSends.therapistUserId} = ${therapistUserId}
            AND ${chatMediaSends.customerId} = ${customerId}
        )`,
      ),
    )
    .orderBy(sql`power(random(), 1.0 / GREATEST(${chatMedia.weight}, 1)) DESC`)
    .limit(1);

  return rows[0] ?? null;
}

export interface RecordMediaSendArgs {
  therapistUserId: string;
  customerId: string;
  mediaId: string;
  conversationId?: string | null;
}

/**
 * 记录一次发图（防重核心），(技师,客户,图) 唯一。
 * returning + onConflictDoNothing：新插入返回 true；命中唯一约束(已发过/并发抢占)返回 false。
 * 调用方可据此做"先占位再发"的原子互斥，杜绝并发重发同一张图。
 */
export async function recordMediaSend(
  ctx: ChatMediaContext,
  { therapistUserId, customerId, mediaId, conversationId }: RecordMediaSendArgs,
): Promise<boolean> {
  const { db } = ctx;
  const rows = await db
    .insert(chatMediaSends)
    .values({
      therapistUserId,
      customerId,
      mediaId,
      conversationId: conversationId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: chatMediaSends.id });
  return rows.length > 0;
}

export interface ImageCooldownArgs {
  therapistUserId: string;
  customerId: string;
  conversationId: string;
  cooldownMessages: number;
}

/**
 * 防连发：距上一次发图后，该会话须新增 >= cooldownMessages 条消息才允许再发。
 * 该 (技师,客户) 从未发过图 → 直接 true。
 */
export async function imageCooldownOk(
  ctx: ChatMediaContext,
  { therapistUserId, customerId, conversationId, cooldownMessages }: ImageCooldownArgs,
): Promise<boolean> {
  const { db } = ctx;

  const lastRows = await db
    .select({ sentAt: chatMediaSends.sentAt })
    .from(chatMediaSends)
    .where(
      and(
        eq(chatMediaSends.therapistUserId, therapistUserId),
        eq(chatMediaSends.customerId, customerId),
      ),
    )
    .orderBy(sql`${chatMediaSends.sentAt} DESC`)
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

  const n = countRows[0]?.n ?? 0;
  return n >= cooldownMessages;
}

/**
 * 取本会话最近 N 条分身文字消息的原文（撩拨话术防重复用：避开最近发过的那几句）。
 * 窄 select，只取 content_original；用于 repeat-distance（最近 N 轮内不重选同一句撩拨）。
 */
export async function recentAlterTexts(
  ctx: ChatMediaContext,
  { conversationId, limit }: { conversationId: string; limit: number },
): Promise<string[]> {
  const rows = await ctx.db
    .select({ text: messages.contentOriginal })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.isAiAlter, 1),
        eq(messages.type, 'text'),
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(limit);
  return rows.map((r) => r.text).filter((t): t is string => !!t);
}
