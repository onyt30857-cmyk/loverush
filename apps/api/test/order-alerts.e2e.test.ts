/**
 * E2E · 后台异常订单监控 + admin 强制取消
 *
 *   adminListOrderAlerts:卡住的非终态单(PENDING_CONFIRM updated_at>1h)被列出,带 alertType/hoursStuck。
 *   cancelOrder(admin):admin 强制取消 → CANCELLED + 退还心动金。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, pointsAccount, orderDeposits, orders } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';
import { adminListOrderAlerts, cancelOrder } from '../src/services/orders';

let customerToken: string;
let customerId: string;
let therapistId: string;

const PRICE = 200;
const EXPECT_DEPOSIT = 20;

async function setBalance(userId: string, balance: number) {
  const db = await getDb();
  await db.insert(pointsAccount).values({ userId, balance, frozen: 0 })
    .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance, frozen: 0 } });
}
async function submitNewOrder(): Promise<string> {
  const res = await api.post<{ id: string }>('/orders',
    { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
    customerToken);
  const orderId = res.body.data!.id;
  await api.post(`/orders/${orderId}/submit`, undefined, customerToken);
  return orderId;
}

describe('E2E · 异常订单监控 + admin 强制取消', () => {
  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    customerToken = c.access_token;
    customerId = c.user.id;
    const t = await registerNew('therapist');
    await api.put('/therapists/me', {
      bio: 'x', serviceCity: 'Bangkok',
      skillsJson: [{ skill: '泰式', level: 5 }],
      basePriceJson: [{ duration: 60, pricePoints: PRICE }],
    }, t.access_token);
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, t.user.id));
    therapistId = (await db.query.therapists.findFirst({ where: eq(therapists.userId, t.user.id) }))!.id;
  }, 30_000);

  it('卡住的待确认单(updated_at 2h前) → 进异常单列表', async () => {
    await setBalance(customerId, 1000);
    const orderId = await submitNewOrder();
    const db = await getDb();
    await db.update(orders).set({ updatedAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(orders.id, orderId));

    const alerts = await adminListOrderAlerts({ db });
    const hit = alerts.find((a) => a.id === orderId);
    expect(hit).toBeTruthy();
    expect(hit?.alertType).toBe('pending_confirm');
    expect(hit?.hoursStuck).toBeGreaterThanOrEqual(1);
  });

  it('admin 强制取消 → CANCELLED + 退还心动金', async () => {
    await setBalance(customerId, 1000);
    const orderId = await submitNewOrder();
    expect((await (await getDb()).query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) }))?.balance).toBe(980);

    await cancelOrder({ db: await getDb() }, orderId, customerId, 'admin 后台干预', 'admin');

    const db = await getDb();
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o?.status).toBe('CANCELLED');
    const dep = await db.query.orderDeposits.findFirst({ where: eq(orderDeposits.orderId, orderId) });
    expect(dep?.status).toBe('RELEASED');
    expect((await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) }))?.balance).toBe(1000);
  });
});
