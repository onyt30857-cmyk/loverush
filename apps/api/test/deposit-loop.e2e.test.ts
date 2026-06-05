/**
 * E2E · 心动金下单闭环(2026-06-05 重构验证)
 *
 * 验证 Tony 三决策落地:所有订单提交即冻结 · 余额不足拦截 · 取消/完单退还。
 * 需要 DATABASE_URL 指向 loverush_test(drizzle-kit push 同步全 schema)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, pointsAccount, orderDeposits, orders } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';

let customerToken: string;
let customerId: string;
let therapistToken: string;
let therapistUserId: string;
let therapistId: string;

const PRICE = 200;          // 服务积分价
const EXPECT_DEPOSIT = 20;  // 10% 心动金

async function setBalance(userId: string, balance: number) {
  const db = await getDb();
  await db
    .insert(pointsAccount)
    .values({ userId, balance, frozen: 0 })
    .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance, frozen: 0 } });
}
async function getAccount(userId: string) {
  const db = await getDb();
  return db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) });
}
async function getOrderRow(orderId: string) {
  const db = await getDb();
  return db.query.orders.findFirst({ where: eq(orders.id, orderId) });
}
async function getDeposit(orderId: string) {
  const db = await getDb();
  return db.query.orderDeposits.findFirst({ where: eq(orderDeposits.orderId, orderId) });
}
async function createOrder(): Promise<string> {
  const res = await api.post<{ id: string; status: string; depositPoints: number | null; depositStatus: string | null }>(
    '/orders',
    { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
    customerToken,
  );
  expect(res.status).toBe(200);
  expect(res.body.data?.status).toBe('DRAFT');
  // 创建即算出应冻结额(展示),但 DRAFT 阶段还没冻结
  expect(res.body.data?.depositPoints).toBe(EXPECT_DEPOSIT);
  expect(res.body.data?.depositStatus).toBeNull();
  return res.body.data!.id;
}

describe('E2E · 心动金下单闭环', () => {
  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    customerToken = c.access_token;
    customerId = c.user.id;

    const t = await registerNew('therapist');
    therapistToken = t.access_token;
    therapistUserId = t.user.id;
    await api.put(
      '/therapists/me',
      {
        bio: '专业按摩 8 年',
        serviceCity: 'Bangkok',
        skillsJson: [{ skill: '泰式', level: 5 }],
        basePriceJson: [{ duration: 60, pricePoints: PRICE }],
      },
      therapistToken,
    );
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, therapistUserId));
    const row = await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) });
    therapistId = row!.id;
  }, 30_000);

  it('quote 报价口径与下单一致(deposit=10%)', async () => {
    const q = await api.post<{ depositPoints: number; totalPoints: number }>(
      '/orders/quote',
      { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
      customerToken,
    );
    expect(q.status).toBe(200);
    expect(q.body.data?.depositPoints).toBe(EXPECT_DEPOSIT);
    expect(q.body.data?.totalPoints).toBe(PRICE);
  });

  it('A · 0 余额提交被拦(E2010)· 订单留 DRAFT · 不冻结', async () => {
    await setBalance(customerId, 0);
    const orderId = await createOrder();

    const submit = await api.post(`/orders/${orderId}/submit`, undefined, customerToken);
    expect(submit.status).toBe(400);
    expect(submit.body.error?.code).toBe('E2010');

    const o = await getOrderRow(orderId);
    expect(o?.status).toBe('DRAFT');           // 没流转
    expect(o?.depositStatus).toBeNull();       // 没冻结
    const dep = await getDeposit(orderId);
    expect(dep).toBeUndefined();               // 无 deposit 记录
    const acc = await getAccount(customerId);
    expect(acc?.balance).toBe(0);              // 余额没动
  });

  // 注:心动金"冻结"实现 = 把钱从 balance 扣出(debit type=FROZEN),释放时 credit 回 balance。
  //     frozen 列未被该流程维护(恒 0),真不变量在 balance —— 断言以 balance 为准。
  it('B · 余额够 → 提交即冻结(balance 扣减 · HOLDING)', async () => {
    await setBalance(customerId, 1000);
    const orderId = await createOrder();

    const submit = await api.post<{ status: string }>(`/orders/${orderId}/submit`, undefined, customerToken);
    expect(submit.status).toBe(200);
    expect(submit.body.data?.status).toBe('PENDING_CONFIRM');

    const o = await getOrderRow(orderId);
    expect(o?.depositStatus).toBe('HOLDING');
    expect(o?.depositPoints).toBe(EXPECT_DEPOSIT);
    const dep = await getDeposit(orderId);
    expect(dep?.status).toBe('HOLDING');
    expect(dep?.depositPoints).toBe(EXPECT_DEPOSIT);
    const acc = await getAccount(customerId);
    expect(acc?.balance).toBe(1000 - EXPECT_DEPOSIT); // 980 · 心动金已离开可用余额
  });

  it('C · 取消订单 → 心动金全额退还(RELEASED · balance 复原)', async () => {
    await setBalance(customerId, 1000);
    const orderId = await createOrder();
    await api.post(`/orders/${orderId}/submit`, undefined, customerToken);
    let acc = await getAccount(customerId);
    expect(acc?.balance).toBe(980); // 冻结后

    const cancel = await api.post<{ status: string }>(`/orders/${orderId}/cancel`, { reason: '临时有事' }, customerToken);
    expect(cancel.status).toBe(200);
    expect(cancel.body.data?.status).toBe('CANCELLED');

    const dep = await getDeposit(orderId);
    expect(dep?.status).toBe('RELEASED');
    expect(dep?.resolution).toBe('order_cancelled');
    acc = await getAccount(customerId);
    expect(acc?.balance).toBe(1000); // 全额回余额
  });

  it('D · 完整流程到完单 → 心动金自动退还(RELEASED)', async () => {
    await setBalance(customerId, 1000);
    const orderId = await createOrder();
    await api.post(`/orders/${orderId}/submit`, undefined, customerToken);
    await api.post(`/orders/${orderId}/confirm`, undefined, therapistToken);
    await api.post(`/orders/${orderId}/pay`, { payment_txn_id: `t_${Date.now()}` }, customerToken);
    await api.post(`/orders/${orderId}/start`, undefined, therapistToken);

    let acc = await getAccount(customerId);
    expect(acc?.balance).toBe(980); // 完成前仍扣着

    const done = await api.post<{ status: string }>(`/orders/${orderId}/complete`, undefined, therapistToken);
    expect(done.status).toBe(200);
    expect(done.body.data?.status).toBe('COMPLETED');

    const dep = await getDeposit(orderId);
    expect(dep?.status).toBe('RELEASED');
    expect(dep?.resolution).toBe('auto_complete');
    acc = await getAccount(customerId);
    expect(acc?.balance).toBe(1000); // 完单自动退回
  });
});
