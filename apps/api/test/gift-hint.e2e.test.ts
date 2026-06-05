/**
 * 对话内礼物卡 · giftHint 编排服务 e2e
 *
 *   detectGiftMoment：命中正面情绪 / 负面一票否决 / 不中
 *   runGiftHintFlow：
 *     - 情绪峰值 + 亲密度>=Lv1 + 冷却OK → 浮 1 条 gift_hint
 *     - 冷却内(无新消息)再跑 → 不重浮
 *     - 新客 Lv0 → 不浮
 *     - 负面情绪 → 不浮
 *
 * 跑：cd apps/api && pnpm exec vitest run test/gift-hint.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, therapists, intimacy } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { detectGiftMoment, runGiftHintFlow } from '../src/services/giftHint';

async function openConv(customerId: string, therapistUserId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.insert(conversations).values({ customerId, therapistUserId }).returning({ id: conversations.id });
  return row!.id;
}

async function giftMsgs(conversationId: string) {
  const db = await getDb();
  return db
    .select({ id: messages.id, content: messages.contentOriginal })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'gift_hint')));
}

describe('礼物卡 · detectGiftMoment 情绪判定', () => {
  it('命中正面情绪', () => {
    expect(detectGiftMoment('你好可爱呀')).toBe(true);
    expect(detectGiftMoment('谢谢你陪我聊天')).toBe(true);
    expect(detectGiftMoment('好喜欢和你聊')).toBe(true);
  });
  it('负面情绪一票否决', () => {
    expect(detectGiftMoment('你好可爱，不过我今天好累')).toBe(false);
    expect(detectGiftMoment('我今天好难过')).toBe(false);
  });
  it('不中 / 空', () => {
    expect(detectGiftMoment('今天几点有空')).toBe(false);
    expect(detectGiftMoment(undefined)).toBe(false);
  });
});

describe('礼物卡 · runGiftHintFlow', () => {
  let therapistUserId: string;
  let customerId: string;
  let conversationId: string;

  beforeAll(async () => {
    await truncateAll();
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    const c = await registerNew('customer');
    customerId = c.user.id;

    const db = await getDb();
    await db.insert(therapists).values({ userId: therapistUserId });
    // 亲密度 Lv1「熟悉」(exp 60 >= 50)
    await db.insert(intimacy).values({ customerId, therapistUserId, exp: 60, level: 1 });

    conversationId = await openConv(customerId, therapistUserId);
  }, 30_000);

  it('情绪峰值 + Lv1 + 冷却OK → 浮 1 条 gift_hint(含 therapistId)', async () => {
    const db = await getDb();
    const sent = await runGiftHintFlow(
      { db },
      { conversationId, customerId, therapistUserId, wantGiftMomentOverride: true },
    );
    expect(sent).toBe(true);
    const offers = await giftMsgs(conversationId);
    expect(offers.length).toBe(1);
    expect(JSON.parse(offers[0]!.content!).therapistId).toBeTruthy();
  });

  it('冷却内(无新消息)再跑 → 不重浮', async () => {
    const db = await getDb();
    const sent = await runGiftHintFlow(
      { db },
      { conversationId, customerId, therapistUserId, wantGiftMomentOverride: true },
    );
    expect(sent).toBe(false);
    expect((await giftMsgs(conversationId)).length).toBe(1);
  });

  it('新客 Lv0 → 不浮', async () => {
    const db = await getDb();
    const t2 = await registerNew('therapist');
    await db.insert(therapists).values({ userId: t2.user.id });
    const c2 = await registerNew('customer'); // 不 seed intimacy → Lv0
    const conv2 = await openConv(c2.user.id, t2.user.id);
    const sent = await runGiftHintFlow(
      { db },
      { conversationId: conv2, customerId: c2.user.id, therapistUserId: t2.user.id, wantGiftMomentOverride: true },
    );
    expect(sent).toBe(false);
    expect((await giftMsgs(conv2)).length).toBe(0);
  });

  it('负面情绪 → 不浮', async () => {
    const db = await getDb();
    const fresh = await registerNew('customer');
    await db.insert(intimacy).values({ customerId: fresh.user.id, therapistUserId, exp: 200, level: 2 });
    const fconv = await openConv(fresh.user.id, therapistUserId);
    const sent = await runGiftHintFlow(
      { db },
      { conversationId: fconv, customerId: fresh.user.id, therapistUserId, customerText: '我今天好难过好累' },
    );
    expect(sent).toBe(false);
    expect((await giftMsgs(fconv)).length).toBe(0);
  });
});
