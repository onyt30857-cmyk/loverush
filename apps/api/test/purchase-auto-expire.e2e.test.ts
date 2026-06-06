/**
 * e2e · 采购订单超时清理(M16,补"订单永久卡死")
 * created 超 2h → expired;customer_paid 超 72h 代理未确认 → disputed;未超时不动。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pointPurchaseOrders } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { expireStalePurchases } from '../src/jobs/purchase-auto-expire';

describe('purchase-auto-expire · 采购订单超时(M16)', () => {
  let customerId: string;
  let agentId: string;

  beforeAll(async () => {
    await truncateAll();
    customerId = (await registerNew('customer')).user.id;
    agentId = (await registerNew('customer')).user.id; // FK 仅到 users.id,这里只需两个合法用户
  });

  it('created 超2h→expired · customer_paid 超72h→disputed · 未超时不动', async () => {
    const db = await getDb();
    const now = Date.now();
    await db.insert(pointPurchaseOrders).values([
      // created 3h 前 → 应 expired
      { customerUserId: customerId, agentUserId: agentId, points: 5000, status: 'created', createdAt: new Date(now - 3 * 3600 * 1000) },
      // customer_paid 80h 前 → 应 disputed
      { customerUserId: customerId, agentUserId: agentId, points: 5000, status: 'customer_paid', createdAt: new Date(now - 100 * 3600 * 1000), customerPaidAt: new Date(now - 80 * 3600 * 1000) },
      // created 1h 前 → 不动
      { customerUserId: customerId, agentUserId: agentId, points: 5000, status: 'created', createdAt: new Date(now - 1 * 3600 * 1000) },
    ]);

    const r = await expireStalePurchases({ db });
    expect(r.expired).toBe(1);
    expect(r.disputed).toBe(1);

    const rows = await db.select().from(pointPurchaseOrders).where(eq(pointPurchaseOrders.customerUserId, customerId));
    expect(rows.map((x) => x.status).sort()).toEqual(['created', 'disputed', 'expired']);
    // disputed 单应标 disputeStatus=open(供后台仲裁)
    expect(rows.find((x) => x.status === 'disputed')?.disputeStatus).toBe('open');
  });

  it('再次跑 → 幂等(已 expired/disputed 不重复处理)', async () => {
    const db = await getDb();
    const r = await expireStalePurchases({ db });
    expect(r.expired).toBe(0);
    expect(r.disputed).toBe(0);
  });
});
