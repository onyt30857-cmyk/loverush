/**
 * E2E · 对话页客户信号
 *
 * 1. getCustomerStats — 老客统计:completedCount 正确统计 COMPLETED/REVIEWED,
 *    其余状态不计入,0 单返回 isRepeatCustomer=false
 * 2. GET/PUT /therapists/me/customers/:customerId/notes — 写后读到正确值,
 *    GET 同时返回 aiSummary(无时 null,有时返回 summary 字段)
 *
 * 需 DATABASE_URL 指向 loverush_test。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, orders, customerRelationshipProfile } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';
import { getCustomerStats } from '../src/services/orders';
import { nanoid } from 'nanoid';

let customerToken: string;
let customerId: string;
let therapistToken: string;
let therapistUserId: string;
let therapistId: string;

type OrderStatus = 'DRAFT' | 'PENDING_CONFIRM' | 'LOCKED' | 'PAID' | 'IN_SERVICE' | 'COMPLETED' | 'REVIEWED' | 'CANCELLED' | 'DISPUTED' | 'REFUNDED' | 'CLOSED';

async function seedOrder(status: OrderStatus): Promise<string> {
  const db = await getDb();
  const d = new Date();
  const yyyymmdd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const orderNo = `LR${yyyymmdd}${nanoid(8).toUpperCase()}`;
  const [o] = await db
    .insert(orders)
    .values({
      orderNo,
      customerId,
      therapistId,       // therapists.id (UUID)
      therapistUserId,   // users.id
      status,
      serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
      pricePoints: 200,
      depositPoints: 0,
      completedAt: status === 'COMPLETED' || status === 'REVIEWED' ? new Date() : null,
    })
    .returning();
  return o!.id;
}

describe('E2E · 客户信号(老客统计 + 备注读写)', () => {
  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    customerToken = c.access_token;
    customerId = c.user.id;

    const t = await registerNew('therapist');
    therapistToken = t.access_token;
    therapistUserId = t.user.id;

    // PUT /therapists/me 触发 upsert therapist 行
    await api.put('/therapists/me', { bio: '测试技师', serviceMode: 'incall' }, therapistToken);

    const db = await getDb();
    await db
      .update(therapists)
      .set({ verificationStatus: 'passed', serviceMode: 'incall' })
      .where(eq(therapists.userId, therapistUserId));
    const tRow = await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) });
    therapistId = tRow!.id;
  });

  // ── getCustomerStats 服务层 ──

  it('无订单时 completedCount=0, isRepeatCustomer=false', async () => {
    const db = await getDb();
    const stats = await getCustomerStats({ db }, therapistUserId, customerId);
    expect(stats.completedCount).toBe(0);
    expect(stats.totalCount).toBe(0);
    expect(stats.isRepeatCustomer).toBe(false);
    expect(stats.lastCompletedAt).toBeNull();
  });

  it('CANCELLED 单不计入 completedCount', async () => {
    await seedOrder('CANCELLED');
    const db = await getDb();
    const stats = await getCustomerStats({ db }, therapistUserId, customerId);
    expect(stats.completedCount).toBe(0);
    expect(stats.totalCount).toBe(1);
    expect(stats.isRepeatCustomer).toBe(false);
  });

  it('COMPLETED 单计入 completedCount', async () => {
    await seedOrder('COMPLETED');
    const db = await getDb();
    const stats = await getCustomerStats({ db }, therapistUserId, customerId);
    expect(stats.completedCount).toBe(1);
    expect(stats.isRepeatCustomer).toBe(true);
    expect(stats.lastCompletedAt).not.toBeNull();
  });

  it('REVIEWED 单也计入 completedCount', async () => {
    await seedOrder('REVIEWED');
    const db = await getDb();
    // 1 CANCELLED + 1 COMPLETED + 1 REVIEWED
    const stats = await getCustomerStats({ db }, therapistUserId, customerId);
    expect(stats.completedCount).toBe(2);
    expect(stats.totalCount).toBe(3);
    expect(stats.isRepeatCustomer).toBe(true);
  });

  // ── HTTP 接口 ──

  it('GET /therapists/me/customers/:id/stats 返回正确数据', async () => {
    const res = await api.get<{ completedCount: number; isRepeatCustomer: boolean }>(
      `/therapists/me/customers/${customerId}/stats`,
      therapistToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.completedCount).toBe(2);
    expect(res.body.data?.isRepeatCustomer).toBe(true);
  });

  // ── 备注读写 ──

  it('GET notes 初始全为空', async () => {
    const res = await api.get<{
      privateNotes: string | null;
      customerNickname: string | null;
      privateTags: string[];
      aiSummary: string | null;
    }>(`/therapists/me/customers/${customerId}/notes`, therapistToken);
    expect(res.status).toBe(200);
    expect(res.body.data?.privateNotes).toBeNull();
    expect(res.body.data?.customerNickname).toBeNull();
    expect(res.body.data?.privateTags).toEqual([]);
    expect(res.body.data?.aiSummary).toBeNull();
  });

  it('PUT 写入后 GET 读到正确值', async () => {
    const put = await api.put(
      `/therapists/me/customers/${customerId}/notes`,
      { customer_nickname: '大客户', private_notes: '喜欢泰式', private_tags: ['回头客', '按摩重手'] },
      therapistToken,
    );
    expect(put.status).toBe(200);

    const res = await api.get<{
      privateNotes: string | null;
      customerNickname: string | null;
      privateTags: string[];
      aiSummary: string | null;
    }>(`/therapists/me/customers/${customerId}/notes`, therapistToken);
    expect(res.status).toBe(200);
    expect(res.body.data?.customerNickname).toBe('大客户');
    expect(res.body.data?.privateNotes).toBe('喜欢泰式');
    expect(res.body.data?.privateTags).toEqual(['回头客', '按摩重手']);
  });

  it('GET notes 在 interactionMemory 有 summary 时返回 aiSummary', async () => {
    const db = await getDb();
    // 给关系行写入 interactionMemory.summary(notes PUT 已建过 crp 行)
    await db
      .update(customerRelationshipProfile)
      .set({ interactionMemory: { summary: '偏好温柔型，常问按摩技法' } })
      .where(eq(customerRelationshipProfile.therapistId, therapistId));

    const res = await api.get<{ aiSummary: string | null }>(
      `/therapists/me/customers/${customerId}/notes`,
      therapistToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.aiSummary).toBe('偏好温柔型，常问按摩技法');
  });

  it('overwrite 备注后 aiSummary 不受影响', async () => {
    const put = await api.put(
      `/therapists/me/customers/${customerId}/notes`,
      { private_notes: '新备注' },
      therapistToken,
    );
    expect(put.status).toBe(200);

    const res = await api.get<{ privateNotes: string | null; aiSummary: string | null }>(
      `/therapists/me/customers/${customerId}/notes`,
      therapistToken,
    );
    expect(res.body.data?.privateNotes).toBe('新备注');
    // aiSummary 来自 interactionMemory,不受 notes PUT 影响
    expect(res.body.data?.aiSummary).toBe('偏好温柔型，常问按摩技法');
  });
});
