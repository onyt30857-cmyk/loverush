/**
 * E2E · IN_SERVICE 超时自动收尾(2026-06-05)
 *
 * 验证:卡在 IN_SERVICE 超 48h 的订单被 cron 自动 completeService(→ COMPLETED + 释放心动金);
 *       未超时的不动。需 loverush_test。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, users, pointsAccount, orders, orderDeposits } from '@loverush/db';
import { createOrder, submitOrder, confirmAndLock, markPaid, startService } from '../src/services/orders';
import { runInServiceTimeout } from '../src/jobs/in-service-timeout';
import { getDb, truncateAll } from './helpers';

let customerId: string;
let ther: { userId: string; therapistId: string };
const snap = { skills: ['泰式'], durationMin: 60, pricePoints: 200 };

async function mkUser(name: string, type: 'customer' | 'therapist'): Promise<string> {
  const db = await getDb();
  const [u] = await db.insert(users).values({ userType: type, status: 'active', displayName: name, bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}` }).returning();
  return u!.id;
}
async function toInService(): Promise<string> {
  const db = await getDb();
  await db.insert(pointsAccount).values({ userId: customerId, balance: 1000, frozen: 0 }).onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 1000, frozen: 0 } });
  const o = await createOrder({ db }, { customerId, therapistId: ther.therapistId, serviceSnapshot: snap });
  await submitOrder({ db }, o.id, customerId);
  await confirmAndLock({ db }, o.id, ther.userId);
  await markPaid({ db }, o.id, `t_${Math.random().toString(36).slice(2)}`, customerId);
  await startService({ db }, o.id, ther.userId);
  return o.id;
}
async function statusOf(id: string) {
  const db = await getDb();
  return (await db.query.orders.findFirst({ where: eq(orders.id, id) }))?.status;
}

describe('E2E · IN_SERVICE 超时自动收尾', () => {
  beforeAll(async () => {
    await truncateAll();
    customerId = await mkUser('Cust', 'customer');
    const tUser = await mkUser('Ther', 'therapist');
    const db = await getDb();
    const [t] = await db.insert(therapists).values({
      userId: tUser, displayName: 'Ther', verificationStatus: 'passed', onlineStatus: 'online',
      serviceMode: 'incall', scoreAppearance: 900, scoreBody: 900, scoreService: 900,
      basePriceJson: [{ duration: 60, pricePoints: 200 }],
    } as never).returning();
    ther = { userId: tUser, therapistId: t!.id };
  }, 30_000);

  it('IN_SERVICE 超 48h → cron 自动完成 + 释放心动金', async () => {
    const id = await toInService();
    const db = await getDb();
    // 余额冻结后应为 980(200×10%=20)
    expect((await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) }))?.balance).toBe(980);
    // backdate started_at 到 49h 前
    await db.update(orders).set({ startedAt: new Date(Date.now() - 49 * 3600 * 1000) }).where(eq(orders.id, id));

    const r = await runInServiceTimeout({ db });
    expect(r.completed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe('COMPLETED');
    // 心动金已释放回客户
    expect((await db.query.orderDeposits.findFirst({ where: eq(orderDeposits.orderId, id) }))?.status).toBe('RELEASED');
    expect((await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) }))?.balance).toBe(1000);
  });

  it('IN_SERVICE 未超时(刚开始)→ cron 不动', async () => {
    const id = await toInService();
    const r = await runInServiceTimeout({ db: await getDb() });
    // 这单刚 start,started_at=now → 不在 due 内
    expect(await statusOf(id)).toBe('IN_SERVICE');
    void r;
  });
});
