/**
 * E2E · 订单待确认超时自动取消
 *
 * 提交进 PENDING_CONFIRM(冻结心动金) → 把 pendingConfirmAt 改成 3h 前(超时) →
 * runOrderPendingConfirmTimeout → 订单 CANCELLED + 心动金 RELEASED + 余额复原 + 不误伤未超时单。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, pointsAccount, orderDeposits, orders } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';
import { runOrderPendingConfirmTimeout } from '../src/jobs/order-pending-confirm-timeout';

let customerToken: string;
let customerId: string;
let therapistId: string;

const PRICE = 200;
const EXPECT_DEPOSIT = 20; // 10%

async function setBalance(userId: string, balance: number) {
  const db = await getDb();
  await db.insert(pointsAccount).values({ userId, balance, frozen: 0 })
    .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance, frozen: 0 } });
}
async function getAccount(userId: string) {
  const db = await getDb();
  return db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) });
}
async function submitNewOrder(): Promise<string> {
  const res = await api.post<{ id: string }>(
    '/orders',
    { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
    customerToken,
  );
  const orderId = res.body.data!.id;
  await api.post(`/orders/${orderId}/submit`, undefined, customerToken);
  return orderId;
}
async function backdatePendingConfirm(orderId: string, hoursAgo: number) {
  const db = await getDb();
  await db.update(orders)
    .set({ pendingConfirmAt: new Date(Date.now() - hoursAgo * 3600_000) })
    .where(eq(orders.id, orderId));
}

describe('E2E · 订单待确认超时自动取消', () => {
  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    customerToken = c.access_token;
    customerId = c.user.id;
    const t = await registerNew('therapist');
    const therapistToken = t.access_token;
    await api.put('/therapists/me', {
      bio: '专业按摩 8 年', serviceCity: 'Bangkok',
      skillsJson: [{ skill: '泰式', level: 5 }],
      basePriceJson: [{ duration: 60, pricePoints: PRICE }],
    }, therapistToken);
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, t.user.id));
    therapistId = (await db.query.therapists.findFirst({ where: eq(therapists.userId, t.user.id) }))!.id;
  }, 30_000);

  it('超时(3h)未确认 → 自动取消 + 退还心动金 + 余额复原', async () => {
    await setBalance(customerId, 1000);
    const orderId = await submitNewOrder();
    expect((await getAccount(customerId))?.balance).toBe(1000 - EXPECT_DEPOSIT); // 冻结后 980

    await backdatePendingConfirm(orderId, 3); // 3h 前 = 超时
    const r = await runOrderPendingConfirmTimeout({ db: await getDb() });
    expect(r.expired).toBeGreaterThanOrEqual(1);

    const db = await getDb();
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o?.status).toBe('CANCELLED');
    const dep = await db.query.orderDeposits.findFirst({ where: eq(orderDeposits.orderId, orderId) });
    expect(dep?.status).toBe('RELEASED');
    expect((await getAccount(customerId))?.balance).toBe(1000); // 全额退回
  });

  it('未超时(刚提交) → 不取消', async () => {
    await setBalance(customerId, 1000);
    const orderId = await submitNewOrder();
    // pendingConfirmAt = 刚才(submit 时 set 的 now),不 backdate

    await runOrderPendingConfirmTimeout({ db: await getDb() });

    const db = await getDb();
    const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    expect(o?.status).toBe('PENDING_CONFIRM'); // 仍待确认,没被误取消
  });
});
