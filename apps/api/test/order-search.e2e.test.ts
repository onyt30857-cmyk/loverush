/**
 * E2E · 后台订单多维搜索(订单号 / 客户名 / 技师名)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, users, orders, pointsAccount } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';
import { adminListOrders } from '../src/services/orders';

let customerToken: string;
let customerId: string;
let therapistUserId: string;
let therapistId: string;
let orderId: string;
let orderNo: string;

const PRICE = 200;

describe('E2E · 后台订单多维搜索', () => {
  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    customerToken = c.access_token;
    customerId = c.user.id;
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    await api.put('/therapists/me', {
      bio: 'x', serviceCity: 'Bangkok',
      skillsJson: [{ skill: '泰式', level: 5 }],
      basePriceJson: [{ duration: 60, pricePoints: PRICE }],
    }, t.access_token);
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, therapistUserId));
    therapistId = (await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) }))!.id;
    // 设可搜的双方昵称
    await db.update(users).set({ displayName: '搜索客户阿强' }).where(eq(users.id, customerId));
    await db.update(users).set({ displayName: '搜索技师小美' }).where(eq(users.id, therapistUserId));
    // 充值 + 建单
    await db.insert(pointsAccount).values({ userId: customerId, balance: 1000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 1000 } });
    const res = await api.post<{ id: string }>('/orders',
      { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
      customerToken);
    orderId = res.body.data!.id;
    orderNo = (await db.query.orders.findFirst({ where: eq(orders.id, orderId) }))!.orderNo;
  }, 30_000);

  it('按订单号搜 → 命中', async () => {
    const list = await adminListOrders({ db: await getDb() }, { search: orderNo });
    expect(list.some((o) => o.id === orderId)).toBe(true);
  });
  it('按客户名搜 → 命中', async () => {
    const list = await adminListOrders({ db: await getDb() }, { search: '阿强' });
    expect(list.some((o) => o.id === orderId)).toBe(true);
  });
  it('按技师名搜 → 命中', async () => {
    const list = await adminListOrders({ db: await getDb() }, { search: '小美' });
    expect(list.some((o) => o.id === orderId)).toBe(true);
  });
  it('搜不存在的词 → 不命中', async () => {
    const list = await adminListOrders({ db: await getDb() }, { search: '不存在的XYZ词' });
    expect(list.some((o) => o.id === orderId)).toBe(false);
  });
});
