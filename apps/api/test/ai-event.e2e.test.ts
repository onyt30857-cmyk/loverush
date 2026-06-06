/**
 * e2e · 跨 AI 统一事件流 customer_ai_event(P0-b 地基)
 *
 * 验证:① emit 双源(M03+M06)写入单一事实源 ② 合规删除按 userId 一键清干净 + 返回计数。
 * 这是"事件统一"地基的管道证明 —— 画像分治、事件统一。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { customerAiEvent } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { emitAiEvent, eraseCustomerAiData } from '../src/services/ai_event';

describe('customer_ai_event · emit + 合规删除(P0-b)', () => {
  let userId: string;

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    userId = c.user.id;
  });

  it('emitAiEvent 写入单一事实源 · M03+M06 双源汇聚到同一客户', async () => {
    const db = await getDb();
    await emitAiEvent({ db }, { userId, source: 'm03', kind: 'price_inquiry', payload: { city: '曼谷' } });
    await emitAiEvent({ db }, { userId, source: 'm06', kind: 'booking_intent' });
    const rows = await db.select().from(customerAiEvent).where(eq(customerAiEvent.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(['m03', 'm06']);
    const m03 = rows.find((r) => r.source === 'm03');
    expect((m03?.payload as { city?: string })?.city).toBe('曼谷');
  });

  it('emit 自吞错不抛(观测/合规用,绝不阻断主流程)', async () => {
    const db = await getDb();
    await expect(
      emitAiEvent({ db }, { userId, source: 'm03', kind: 'sales_push' }),
    ).resolves.toBeUndefined();
  });

  it('eraseCustomerAiData 一键清干净事件流 + 返回审计计数', async () => {
    const db = await getDb();
    const before = await db.select().from(customerAiEvent).where(eq(customerAiEvent.userId, userId));
    expect(before.length).toBeGreaterThanOrEqual(3); // 前两测共 emit 3 条

    const { deleted } = await eraseCustomerAiData({ db }, userId);
    expect(deleted.customer_ai_event).toBe(before.length);
    // 删除函数覆盖的其他记忆表也应有计数键(本测未塞数据 → 0)
    expect(deleted).toHaveProperty('customer_saved_memory');
    expect(deleted).toHaveProperty('customer_relationship_profile');
    expect(deleted).toHaveProperty('assistant_chat_log');

    const after = await db.select().from(customerAiEvent).where(eq(customerAiEvent.userId, userId));
    expect(after).toHaveLength(0); // 真清干净
  });
});
