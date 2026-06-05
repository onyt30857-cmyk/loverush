/**
 * 对话内选时段卡 · scheduleOffer 编排服务 e2e
 *
 *   detectScheduleIntent：命中问档期词 / 不中闲聊
 *   runScheduleOfferFlow：
 *     - 命中意图 + 技师有排班+空档 → 发 1 条 schedule_offer(slots 非空)
 *     - 冷却内(无新消息)再跑 → 不重发
 *     - 技师无排班 → 不发(两天都无空档)
 *
 * 跑：cd apps/api && pnpm exec vitest run test/schedule-offer.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, therapists, therapistWorkingHours } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { detectScheduleIntent, runScheduleOfferFlow } from '../src/services/scheduleOffer';

async function openConv(customerId: string, therapistUserId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(conversations)
    .values({ customerId, therapistUserId })
    .returning({ id: conversations.id });
  return row!.id;
}

async function scheduleMsgs(conversationId: string) {
  const db = await getDb();
  return db
    .select({ id: messages.id, content: messages.contentOriginal })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'schedule_offer')));
}

describe('选时段卡 · detectScheduleIntent 关键词', () => {
  it('命中问档期意图', () => {
    expect(detectScheduleIntent('你几点有空呀')).toBe(true);
    expect(detectScheduleIntent('今晚能约吗')).toBe(true);
    expect(detectScheduleIntent('什么时候有空')).toBe(true);
    expect(detectScheduleIntent('哪天方便')).toBe(true);
  });
  it('不中闲聊 / 空', () => {
    expect(detectScheduleIntent('今天天气真好')).toBe(false);
    expect(detectScheduleIntent('你叫什么名字')).toBe(false);
    expect(detectScheduleIntent(undefined)).toBe(false);
  });
});

describe('选时段卡 · runScheduleOfferFlow', () => {
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
    await db.insert(therapists).values({
      userId: therapistUserId,
      basePriceJson: [{ duration: 60, pricePoints: 1500, currencyCode: 'THB', priceFiat: 1500 }],
    });
    // 今天 + 明天全天可约排班(UTC weekday,匹配 computeAvailability 口径)
    const wd0 = new Date().getUTCDay();
    const wd1 = new Date(Date.now() + 86_400_000).getUTCDay();
    await db.insert(therapistWorkingHours).values([
      { therapistUserId, weekday: wd0, startTime: '00:00', endTime: '23:59', isActive: true },
      { therapistUserId, weekday: wd1, startTime: '00:00', endTime: '23:59', isActive: true },
    ]);

    conversationId = await openConv(customerId, therapistUserId);
  }, 30_000);

  it('命中问档期 + 有排班空档 → 发 1 条 schedule_offer(slots 非空)', async () => {
    const db = await getDb();
    const sent = await runScheduleOfferFlow(
      { db },
      { conversationId, customerId, therapistUserId, cooldownMessages: 6, wantScheduleOverride: true },
    );
    expect(sent).toBe(true);

    const offers = await scheduleMsgs(conversationId);
    expect(offers.length).toBe(1);
    const parsed = JSON.parse(offers[0]!.content!);
    expect(parsed.therapistId).toBeTruthy();
    expect(Array.isArray(parsed.slots)).toBe(true);
    expect(parsed.slots.length).toBeGreaterThan(0);
    expect(typeof parsed.slots[0].startAt).toBe('string');
  });

  it('冷却内(cooldown=6,无新消息)再跑 → 不重发', async () => {
    const db = await getDb();
    const sent = await runScheduleOfferFlow(
      { db },
      { conversationId, customerId, therapistUserId, cooldownMessages: 6, wantScheduleOverride: true },
    );
    expect(sent).toBe(false);
    expect((await scheduleMsgs(conversationId)).length).toBe(1);
  });

  it('不中意图 → 不发', async () => {
    const db = await getDb();
    const fresh = await registerNew('customer');
    const fconv = await openConv(fresh.user.id, therapistUserId);
    const sent = await runScheduleOfferFlow(
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
    expect((await scheduleMsgs(fconv)).length).toBe(0);
  });

  it('技师无排班 → 两天都无空档 → 不发', async () => {
    const db = await getDb();
    const t2 = await registerNew('therapist');
    await db.insert(therapists).values({ userId: t2.user.id }); // 无 working_hours
    const c2 = await registerNew('customer');
    const conv2 = await openConv(c2.user.id, t2.user.id);
    const sent = await runScheduleOfferFlow(
      { db },
      {
        conversationId: conv2,
        customerId: c2.user.id,
        therapistUserId: t2.user.id,
        cooldownMessages: 6,
        wantScheduleOverride: true,
      },
    );
    expect(sent).toBe(false);
    expect((await scheduleMsgs(conv2)).length).toBe(0);
  });
});
