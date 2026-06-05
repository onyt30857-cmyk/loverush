/**
 * E2E · 确认后取消跳单惩罚(2026-06-05)
 *
 * 规则:确认前取消/技师取消/宽限内取消 → 全退;客户在技师确认后(LOCKED)超 5 分钟宽限取消 → 扣 50%(归平台)退 50%。
 * deposit = 200×10% = 20;hold 后 balance 980;全退→1000;扣50%→990。需 loverush_test。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, users, pointsAccount, orders, orderDeposits } from '@loverush/db';
import { createOrder, submitOrder, confirmAndLock, cancelOrder } from '../src/services/orders';
import { getDb, truncateAll } from './helpers';

let customerId: string;
let ther: { userId: string; therapistId: string };
const snap = { skills: ['泰式'], durationMin: 60, pricePoints: 200 };

async function mkUser(name: string, type: 'customer' | 'therapist'): Promise<string> {
  const db = await getDb();
  const [u] = await db.insert(users).values({ userType: type, status: 'active', displayName: name, bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}` }).returning();
  return u!.id;
}
async function resetBalance(b: number) {
  const db = await getDb();
  await db.insert(pointsAccount).values({ userId: customerId, balance: b, frozen: 0 }).onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: b, frozen: 0 } });
}
async function bal(): Promise<number> {
  const db = await getDb();
  return (await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) }))?.balance ?? -1;
}
async function depStatus(orderId: string): Promise<string | undefined> {
  const db = await getDb();
  return (await db.query.orderDeposits.findFirst({ where: eq(orderDeposits.orderId, orderId) }))?.status;
}
async function placeSubmit(): Promise<string> {
  const o = await createOrder({ db: await getDb() }, { customerId, therapistId: ther.therapistId, serviceSnapshot: snap });
  await submitOrder({ db: await getDb() }, o.id, customerId);
  return o.id;
}
async function backdateLock(orderId: string, minutesAgo: number) {
  const db = await getDb();
  await db.update(orders).set({ priceLockedAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(orders.id, orderId));
}

describe('E2E · 取消跳单惩罚', () => {
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

  it('确认前(PENDING_CONFIRM)客户取消 → 全退', async () => {
    await resetBalance(1000);
    const id = await placeSubmit();
    expect(await bal()).toBe(980); // 已冻结
    await cancelOrder({ db: await getDb() }, id, customerId, '不等了', 'customer');
    expect(await bal()).toBe(1000); // 全退
    expect(await depStatus(id)).toBe('RELEASED');
  });

  it('确认后超宽限(>5min)客户取消 → 扣 50% 退 50%', async () => {
    await resetBalance(1000);
    const id = await placeSubmit();
    await confirmAndLock({ db: await getDb() }, id, ther.userId);
    await backdateLock(id, 6); // 锁价 6 分钟前 → 超宽限
    await cancelOrder({ db: await getDb() }, id, customerId, '不想要了', 'customer');
    expect(await bal()).toBe(990); // 退回 10(50%),损失 10
    expect(await depStatus(id)).toBe('FORFEITED_TO_PLATFORM');
  });

  it('确认后宽限内(刚确认)客户取消 → 全退', async () => {
    await resetBalance(1000);
    const id = await placeSubmit();
    await confirmAndLock({ db: await getDb() }, id, ther.userId); // priceLockedAt=now → 宽限内
    await cancelOrder({ db: await getDb() }, id, customerId, '手滑了', 'customer');
    expect(await bal()).toBe(1000); // 全退
    expect(await depStatus(id)).toBe('RELEASED');
  });

  it('确认后超宽限 · 技师取消 → 全退客户(技师的锅,不罚客户)', async () => {
    await resetBalance(1000);
    const id = await placeSubmit();
    await confirmAndLock({ db: await getDb() }, id, ther.userId);
    await backdateLock(id, 6);
    await cancelOrder({ db: await getDb() }, id, ther.userId, '我有事去不了', 'therapist');
    expect(await bal()).toBe(1000); // 全退
    expect(await depStatus(id)).toBe('RELEASED');
  });
});
