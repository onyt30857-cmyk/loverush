/**
 * 对话内下单卡 · orderOffer 编排服务 e2e
 *
 *   detectBookingIntent：命中下单词 / 不中闲聊
 *   runBookingOfferFlow：
 *     - 命中意图 + 技师有套餐 → 发 1 条 order_offer(content 含 therapistId+tiers)
 *     - 冷却内(无新消息)再跑 → 不重发
 *     - 不中意图 → 不发
 *     - 技师无套餐 → 不发空卡
 *
 * 跑：cd apps/api && pnpm exec vitest run test/order-offer.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, therapists } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { detectBookingIntent, runBookingOfferFlow } from '../src/services/orderOffer';

async function openConv(customerId: string, therapistUserId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(conversations)
    .values({ customerId, therapistUserId })
    .returning({ id: conversations.id });
  return row!.id;
}

async function offerMsgs(conversationId: string) {
  const db = await getDb();
  return db
    .select({ id: messages.id, content: messages.contentOriginal })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'order_offer')));
}

describe('下单卡 · detectBookingIntent 关键词', () => {
  it('命中下单意图', () => {
    expect(detectBookingIntent('怎么下单啊')).toBe(true);
    expect(detectBookingIntent('我想预约你')).toBe(true);
    expect(detectBookingIntent('怎么约')).toBe(true);
    expect(detectBookingIntent('how to book')).toBe(true);
  });
  it('不中闲聊 / 空', () => {
    expect(detectBookingIntent('今天天气真好')).toBe(false);
    expect(detectBookingIntent('你在干嘛呢')).toBe(false);
    expect(detectBookingIntent(undefined)).toBe(false);
  });
});

describe('下单卡 · runBookingOfferFlow', () => {
  let therapistUserId: string;
  let customerId: string;
  let conversationId: string;
  let therapistId: string;

  beforeAll(async () => {
    await truncateAll();
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    const c = await registerNew('customer');
    customerId = c.user.id;

    const db = await getDb();
    const [trow] = await db
      .insert(therapists)
      .values({
        userId: therapistUserId,
        basePriceJson: [
          { duration: 60, pricePoints: 1500, currencyCode: 'THB', priceFiat: 1500 },
          { duration: 90, pricePoints: 2200, currencyCode: 'THB', priceFiat: 2200 },
        ],
      })
      .returning({ id: therapists.id });
    therapistId = trow!.id;

    conversationId = await openConv(customerId, therapistUserId);
  }, 30_000);

  it('命中下单意图 + 有套餐 → 发 1 条 order_offer(含 therapistId+2 套餐)', async () => {
    const db = await getDb();
    const sent = await runBookingOfferFlow(
      { db },
      { conversationId, customerId, therapistUserId, cooldownMessages: 6, wantBookingOverride: true },
    );
    expect(sent).toBe(true);

    const offers = await offerMsgs(conversationId);
    expect(offers.length).toBe(1);
    const parsed = JSON.parse(offers[0]!.content!);
    expect(parsed.therapistId).toBe(therapistId);
    expect(parsed.tiers.length).toBe(2);
    expect(parsed.tiers[0].duration).toBe(60);
  });

  it('冷却内(cooldown=6,无新消息)再跑 → 不重发', async () => {
    const db = await getDb();
    const sent = await runBookingOfferFlow(
      { db },
      { conversationId, customerId, therapistUserId, cooldownMessages: 6, wantBookingOverride: true },
    );
    expect(sent).toBe(false);
    expect((await offerMsgs(conversationId)).length).toBe(1);
  });

  it('不中意图 → 不发', async () => {
    const db = await getDb();
    const fresh = await registerNew('customer');
    const fconv = await openConv(fresh.user.id, therapistUserId);
    const sent = await runBookingOfferFlow(
      { db },
      {
        conversationId: fconv,
        customerId: fresh.user.id,
        therapistUserId,
        cooldownMessages: 6,
        customerText: '今天天气好',
      },
    );
    expect(sent).toBe(false);
    expect((await offerMsgs(fconv)).length).toBe(0);
  });

  it('技师无套餐 → 不发空卡', async () => {
    const db = await getDb();
    const t2 = await registerNew('therapist');
    await db.insert(therapists).values({ userId: t2.user.id }); // 默认 basePriceJson=[]
    const c2 = await registerNew('customer');
    const conv2 = await openConv(c2.user.id, t2.user.id);
    const sent = await runBookingOfferFlow(
      { db },
      {
        conversationId: conv2,
        customerId: c2.user.id,
        therapistUserId: t2.user.id,
        cooldownMessages: 6,
        wantBookingOverride: true,
      },
    );
    expect(sent).toBe(false);
    expect((await offerMsgs(conv2)).length).toBe(0);
  });
});
