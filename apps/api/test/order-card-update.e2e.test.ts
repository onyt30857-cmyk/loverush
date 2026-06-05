/**
 * 订单卡原地更新 e2e · sendOrderCard 发卡 → 改状态 → updateOrderCard 原地更新同一条卡的 content
 * 跑：cd apps/api && DATABASE_URL=...loverush_test pnpm exec vitest run test/order-card-update.e2e.test.ts
 */
import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { therapists, orders, conversations, messages } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { sendOrderCard, updateOrderCard } from '../src/services/orderCard';

describe('订单卡原地更新', () => {
  it('发卡 → 改状态为COMPLETED → updateOrderCard 原地更新同一条卡', async () => {
    await truncateAll();
    const tUserId = (await registerNew('therapist')).user.id;
    const cUserId = (await registerNew('customer')).user.id;
    const db = await getDb();
    const [th1] = await db.insert(therapists).values({ userId: tUserId, serviceMode: 'outcall', serviceArea: '通罗' }).returning({ id: therapists.id });
    // 直接 seed 一张待确认订单
    const [o] = await db
      .insert(orders)
      .values({
        customerId: cUserId,
        therapistUserId: tUserId,
        therapistId: th1!.id,
        orderNo: 'TEST-OC-1',
        status: 'PENDING_CONFIRM',
        serviceSnapshot: { skills: ['泰式按摩'], durationMin: 90, pricePoints: 0 },
        pricePoints: 1500,
        scheduledAt: new Date('2026-06-08T19:00:00Z'),
        serviceMode: 'outcall',
        customerAreaName: '素坤逸 Soi 11',
        depositPoints: 200,
      })
      .returning({ id: orders.id });
    const orderId = o!.id;

    // ① 发卡
    const sent = await sendOrderCard({ db }, orderId);
    expect(sent.sent).toBe(true);
    // 对话里有 1 条 order_card,content 状态=PENDING_CONFIRM
    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.customerId, cUserId), eq(conversations.therapistUserId, tUserId)),
    });
    const cards1 = await db.select().from(messages).where(and(eq(messages.conversationId, conv!.id), eq(messages.type, 'order_card')));
    expect(cards1.length).toBe(1);
    const p1 = JSON.parse(cards1[0]!.contentOriginal ?? '{}');
    expect(p1.status).toBe('PENDING_CONFIRM');
    expect(p1.serviceMode).toBe('outcall');
    expect(p1.areaName).toBe('素坤逸 Soi 11');
    const cardId = cards1[0]!.id;

    // ② 改状态 → updateOrderCard
    await db.update(orders).set({ status: 'COMPLETED' }).where(eq(orders.id, orderId));
    const upd = await updateOrderCard({ db }, orderId);
    expect(upd.updated).toBe(true);

    // ③ 还是同一条卡(原地更新,不新增),content 状态=COMPLETED
    const cards2 = await db.select().from(messages).where(and(eq(messages.conversationId, conv!.id), eq(messages.type, 'order_card')));
    expect(cards2.length).toBe(1); // 没新增,原地更新
    expect(cards2[0]!.id).toBe(cardId);
    expect(JSON.parse(cards2[0]!.contentOriginal ?? '{}').status).toBe('COMPLETED');
  });

  it('没有订单卡的订单 → updateOrderCard noop(updated:false)', async () => {
    await truncateAll();
    const tUserId = (await registerNew('therapist')).user.id;
    const cUserId = (await registerNew('customer')).user.id;
    const db = await getDb();
    const [th2] = await db.insert(therapists).values({ userId: tUserId }).returning({ id: therapists.id });
    const [o] = await db
      .insert(orders)
      .values({
        customerId: cUserId,
        therapistUserId: tUserId,
        therapistId: th2!.id,
        orderNo: 'TEST-OC-2',
        status: 'PENDING_CONFIRM',
        serviceSnapshot: { skills: ['按摩'], durationMin: 60, pricePoints: 0 },
        pricePoints: 1000,
        depositPoints: 100,
      })
      .returning({ id: orders.id });
    const r = await updateOrderCard({ db }, o!.id);
    expect(r.updated).toBe(false); // 没发过卡 → 不更新
  });
});
