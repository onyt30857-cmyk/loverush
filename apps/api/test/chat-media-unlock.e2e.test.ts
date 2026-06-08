/**
 * M18 撩拨发图 · Phase 2b · 付费私密图解锁 e2e
 *
 * 主干：注册 customer+therapist → seed 1 张 paid 图 → 建会话 → 给客户充 500 积分
 *   用例1 解锁 → 200，发真图；客户 -50（450），技师 +35（floor(50*0.7)），messages 出现 1 张 type=image
 *   用例2 同图再解锁 → 客户余额不变（幂等不重复扣）
 *   用例3 新无钱客户解锁另一张 paid 图 → 400（余额不足）
 *
 * 跑：
 *   cd apps/api
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/chat-media-unlock.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { chatMedia, conversations, messages, pointsAccount } from '@loverush/db';
import { api, getDb, registerNew, truncateAll, creditPointsForTest } from './helpers';

interface UnlockResult {
  imageUrl: string;
  pricePoints: number;
  alreadyUnlocked: boolean;
}

async function balanceOf(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ balance: pointsAccount.balance })
    .from(pointsAccount)
    .where(eq(pointsAccount.userId, userId))
    .limit(1);
  return rows[0]?.balance ?? 0;
}

async function imageMsgs(conversationId: string) {
  const db = await getDb();
  return db
    .select({ id: messages.id, type: messages.type, content: messages.contentOriginal })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'image')));
}

describe('M18 撩拨发图 · 付费私密图解锁', () => {
  let customerToken: string;
  let customerId: string;
  let therapistUserId: string;
  let mediaId: string;
  let conversationId: string;
  const secretUrl = 'https://cdn.test/secret.jpg';

  beforeAll(async () => {
    await truncateAll();

    const customer = await registerNew('customer');
    customerToken = customer.access_token;
    customerId = customer.user.id;

    const therapist = await registerNew('therapist');
    therapistUserId = therapist.user.id;

    const db = await getDb();
    const [media] = await db
      .insert(chatMedia)
      .values({
        therapistUserId,
        tier: 'paid',
        pricePoints: 50,
        intimacyMin: 0,
        url: secretUrl,
      })
      .returning({ id: chatMedia.id });
    mediaId = media!.id;

    const [conv] = await db
      .insert(conversations)
      .values({ customerId, therapistUserId })
      .returning({ id: conversations.id });
    conversationId = conv!.id;

    // 给客户充 500 积分(直充已 410 下线,测试直接铸积分)
    await creditPointsForTest(customerId, 500);
  }, 30_000);

  it('用例1：解锁 → 200，发真图，扣费 50，技师分成 35', async () => {
    const res = await api.post<UnlockResult>(
      `/companion-media/${mediaId}/unlock`,
      { conversation_id: conversationId },
      customerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.imageUrl).toBe(secretUrl);
    expect(res.body.data?.alreadyUnlocked).toBe(false);

    // 客户余额 500 - 50 = 450
    expect(await balanceOf(customerId)).toBe(450);
    // 技师分成 floor(50 * 7000 / 10000) = 35
    expect(await balanceOf(therapistUserId)).toBe(35);

    // messages 出现 1 张 type=image，content=图url
    const imgs = await imageMsgs(conversationId);
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.content).toBe(secretUrl);
  });

  it('用例2：同图再解锁 → 客户余额不变（幂等不重复扣）', async () => {
    const res = await api.post<UnlockResult>(
      `/companion-media/${mediaId}/unlock`,
      { conversation_id: conversationId },
      customerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.alreadyUnlocked).toBe(true);

    // 余额仍 450（不再扣）
    expect(await balanceOf(customerId)).toBe(450);
    // 图仍只有 1 张（幂等不重发）
    const imgs = await imageMsgs(conversationId);
    expect(imgs.length).toBe(1);
  });

  it('用例3：新无钱客户解锁另一张 paid 图 → 400（余额不足）', async () => {
    const db = await getDb();
    const poor = await registerNew('customer');
    const poorToken = poor.access_token;

    const [media2] = await db
      .insert(chatMedia)
      .values({
        therapistUserId,
        tier: 'paid',
        pricePoints: 50,
        intimacyMin: 0,
        url: 'https://cdn.test/secret-2.jpg',
      })
      .returning({ id: chatMedia.id });

    const [conv2] = await db
      .insert(conversations)
      .values({ customerId: poor.user.id, therapistUserId })
      .returning({ id: conversations.id });

    const res = await api.post(
      `/companion-media/${media2!.id}/unlock`,
      { conversation_id: conv2!.id },
      poorToken,
    );
    expect(res.status).toBe(400);
  });
});
