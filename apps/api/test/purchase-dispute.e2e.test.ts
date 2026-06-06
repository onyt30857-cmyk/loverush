/**
 * e2e · 采购争议仲裁(M16,补断链)
 * cron 把超时未确认的 customer_paid 标 disputed 后，admin 仲裁：
 *   release_to_customer → 强制转积分给客户(代理 -N、客户 +N、status points_sent、disputeStatus resolved)
 *   reject              → 标 cancelled、无积分变动、disputeStatus resolved
 *   非 disputed 单仲裁  → 抛错
 *   已 resolved 再仲裁  → 抛错(防双付)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pointPurchaseOrders, pointsAccount } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { credit } from '../src/services/points';
import { adminResolvePurchase } from '../src/services/agents';

async function balanceOf(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) });
  return row?.balance ?? 0;
}

describe('purchase-dispute · 采购争议仲裁(M16)', () => {
  let customerId: string;
  let agentId: string;

  beforeAll(async () => {
    await truncateAll();
    customerId = (await registerNew('customer')).user.id;
    agentId = (await registerNew('customer')).user.id; // 代理也是 users 行；这里只需合法 FK
    const db = await getDb();
    // 给代理铺底积分，转账才有源
    await credit({ db }, { userId: agentId, type: 'ADJUSTMENT', amount: 100_000, description: 'seed' });
  });

  it('release_to_customer：disputed → 客户 +N、代理 -N、points_sent、resolved', async () => {
    const db = await getDb();
    const agentBefore = await balanceOf(agentId);
    const [order] = await db
      .insert(pointPurchaseOrders)
      .values({
        customerUserId: customerId,
        agentUserId: agentId,
        points: 5000,
        status: 'disputed',
        disputeStatus: 'open',
        customerPaidAt: new Date(),
      })
      .returning();

    const row = await adminResolvePurchase({ db }, { orderId: order!.id, resolution: 'release_to_customer' });
    expect(row.status).toBe('points_sent');
    expect(row.disputeStatus).toBe('resolved');
    expect(await balanceOf(customerId)).toBe(5000);
    expect(await balanceOf(agentId)).toBe(agentBefore - 5000);

    const persisted = await db.query.pointPurchaseOrders.findFirst({ where: eq(pointPurchaseOrders.id, order!.id) });
    expect(persisted?.status).toBe('points_sent');
    expect(persisted?.disputeStatus).toBe('resolved');
    expect(persisted?.transferTxnId).toBeTruthy();
  });

  it('reject：disputed → cancelled、无积分变动、resolved', async () => {
    const db = await getDb();
    const custBefore = await balanceOf(customerId);
    const agentBefore = await balanceOf(agentId);
    const [order] = await db
      .insert(pointPurchaseOrders)
      .values({
        customerUserId: customerId,
        agentUserId: agentId,
        points: 3000,
        status: 'disputed',
        disputeStatus: 'open',
        customerPaidAt: new Date(),
      })
      .returning();

    const row = await adminResolvePurchase({ db }, { orderId: order!.id, resolution: 'reject' });
    expect(row.status).toBe('cancelled');
    expect(row.disputeStatus).toBe('resolved');
    expect(await balanceOf(customerId)).toBe(custBefore);
    expect(await balanceOf(agentId)).toBe(agentBefore);
  });

  it('非 disputed 单仲裁 → 抛错', async () => {
    const db = await getDb();
    const [order] = await db
      .insert(pointPurchaseOrders)
      .values({ customerUserId: customerId, agentUserId: agentId, points: 1000, status: 'created' })
      .returning();
    await expect(adminResolvePurchase({ db }, { orderId: order!.id, resolution: 'reject' })).rejects.toThrow();
  });

  it('已 resolved 再仲裁 → 抛错(防双付)', async () => {
    const db = await getDb();
    const [order] = await db
      .insert(pointPurchaseOrders)
      .values({
        customerUserId: customerId,
        agentUserId: agentId,
        points: 2000,
        status: 'disputed',
        disputeStatus: 'open',
        customerPaidAt: new Date(),
      })
      .returning();
    await adminResolvePurchase({ db }, { orderId: order!.id, resolution: 'release_to_customer' });
    // 已变 points_sent，再仲裁应被状态门拦住，绝不二次转账
    await expect(
      adminResolvePurchase({ db }, { orderId: order!.id, resolution: 'release_to_customer' }),
    ).rejects.toThrow();
  });
});
