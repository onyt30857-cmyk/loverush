/**
 * M18 撩拨发图 · Phase 2b · 付费私密图解锁（变现核心）
 *
 * unlockChatMedia：客户花积分解锁一张 paid 私密图。
 *   1. 窄 select chat_media → 校验存在 + isActive
 *   2. 窄 select chat_media_sends → 已发过则幂等返回（不重复扣费）
 *   3. debit 客户 pricePoints（CHAT_SPEND，余额不足由 debit 内部抛 E2010）
 *   4. credit 技师分成 floor(price * 7000/10000)（CHAT_EARN，平台留差额）
 *   5. sendMessage 发真图（type=image，分身身份，零标识）
 *   6. recordMediaSend 记录（防重核心，再次解锁走幂等分支）
 *
 * 铁律：
 *   - 全部窄 select（.select({...}).from()），绝不用 db.query.X.findFirst（并发 schema 漂移会 42703）。
 *   - 计费走 points.ts 的 debit/credit（原子 + 幂等 + 流水），metadata.scene='companion_media' 区分来源。
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { chatMedia, chatMediaSends } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { credit, debit } from './points';
import { recordPlatformRevenue } from './platform-revenue';
import { sendMessage } from './chat';
import { recordMediaSend } from './chatMedia';

/** 技师分成比例（万分比）：7000 = 70%，平台留 30%。 */
export const MEDIA_SHARE_BPS = 7000;

export interface ChatMediaUnlockContext {
  db: Database;
}

export interface UnlockChatMediaArgs {
  customerId: string;
  mediaId: string;
  conversationId: string;
}

export interface UnlockChatMediaResult {
  imageUrl: string;
  pricePoints: number;
  alreadyUnlocked: boolean;
}

export async function unlockChatMedia(
  ctx: ChatMediaUnlockContext,
  { customerId, mediaId, conversationId }: UnlockChatMediaArgs,
): Promise<UnlockChatMediaResult> {
  const { db } = ctx;

  // 1) 窄 select 图（存在 + 启用）
  const mediaRows = await db
    .select({
      id: chatMedia.id,
      url: chatMedia.url,
      pricePoints: chatMedia.pricePoints,
      therapistUserId: chatMedia.therapistUserId,
      isActive: chatMedia.isActive,
    })
    .from(chatMedia)
    .where(eq(chatMedia.id, mediaId))
    .limit(1);

  const media = mediaRows[0];
  if (!media || media.isActive !== 1) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'media not found');
  }

  // 2) 已发过 → 幂等返回（不再扣费/不再发图）
  const sentRows = await db
    .select({ id: chatMediaSends.id })
    .from(chatMediaSends)
    .where(
      and(
        eq(chatMediaSends.therapistUserId, media.therapistUserId),
        eq(chatMediaSends.customerId, customerId),
        eq(chatMediaSends.mediaId, media.id),
      ),
    )
    .limit(1);

  if (sentRows[0]) {
    return { imageUrl: media.url, pricePoints: media.pricePoints, alreadyUnlocked: true };
  }

  // 3) 客户出账（余额不足 → debit 内部抛 E2010_BALANCE_INSUFFICIENT，路由转 400）
  await debit(
    { db },
    {
      userId: customerId,
      type: 'CHAT_SPEND',
      amount: media.pricePoints,
      description: `companion_media:${media.id}`,
      relatedUserId: media.therapistUserId,
      idempotencyKey: `companion-media.${customerId}.${media.id}`,
      metadata: { scene: 'companion_media', mediaId: media.id },
    },
  );

  // 4) 技师分成入账（平台留差额，隐式）
  const share = Math.floor((media.pricePoints * MEDIA_SHARE_BPS) / 10000);
  if (share > 0) {
    await credit(
      { db },
      {
        userId: media.therapistUserId,
        type: 'CHAT_EARN',
        amount: share,
        description: `companion_media:${media.id}`,
        relatedUserId: customerId,
        idempotencyKey: `companion-media.${customerId}.${media.id}.share`,
        metadata: { scene: 'companion_media', mediaId: media.id },
      },
    );
  }

  // 平台收入:客户付的 - 技师分成 = 平台抽成(此前蒸发,现入账可对账)
  await recordPlatformRevenue(
    { db },
    {
      source: 'chat_media',
      amount: media.pricePoints - share,
      refId: `companion-media.${customerId}.${media.id}`,
      customerUserId: customerId,
      therapistUserId: media.therapistUserId,
      metadata: { mediaId: media.id },
    },
  );

  // 5) 发真图（type=image，分身身份发，零标识）
  await sendMessage(
    { db },
    {
      conversationId,
      senderUserId: media.therapistUserId,
      text: media.url,
      type: 'image',
      isAiAlter: true,
    },
  );

  // 6) 记录发送（防重核心，再次解锁走幂等分支）
  await recordMediaSend(
    { db },
    {
      therapistUserId: media.therapistUserId,
      customerId,
      mediaId: media.id,
      conversationId,
    },
  );

  return { imageUrl: media.url, pricePoints: media.pricePoints, alreadyUnlocked: false };
}
