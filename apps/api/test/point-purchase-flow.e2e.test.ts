/**
 * M16 积分采购正向主流程 e2e · 入金闭环(客户向代理买积分)
 *
 * created → customer_paid → points_sent，验证:积分原子转账到客户、代理扣减、售出量累加。
 * 此前只有 purchase-dispute / purchase-auto-expire 边缘 e2e,正向 happy path
 * (整条入金链能不能真跑通)从没端到端测过——这正是"代码在、从没真跑通一笔"的盲区。
 *
 * 跑：cd apps/api && DATABASE_URL=...loverush_test pnpm exec vitest run test/point-purchase-flow.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pointPurchaseOrders, agentProfiles, pointsAccount } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import {
  grantAgent,
  createPurchaseOrder,
  markPurchasePaid,
  confirmPurchaseAndTransfer,
  upsertPaymentMethod,
} from '../src/services/agents';
import { credit } from '../src/services/points';

describe('M16 积分采购正向主流程 · 入金闭环', () => {
  let customerId: string;
  let agentId: string;
  let pmId: string;
  let mainOrderId: string;

  beforeAll(async () => {
    await truncateAll();
    const customer = await registerNew('customer');
    customerId = customer.user.id;
    const agent = await registerNew('customer'); // 代理也是 users 行,再授 agent 角色
    agentId = agent.user.id;

    const db = await getDb();
    const ctx = { db };
    // 建代理(服务泰国) + 充积分库存(否则确认时转账余额不足) + 加收款方式
    await grantAgent(ctx, { userId: agentId, serviceCountries: ['TH'] });
    await credit(ctx, { userId: agentId, type: 'ADJUSTMENT', amount: 100_000, description: 'seed 代理库存' });
    const pm = await upsertPaymentMethod(ctx, {
      agentUserId: agentId,
      country: 'TH',
      methodType: 'promptpay',
      fields: { account: '0812345678' },
      minPurchasePoints: 100,
    });
    pmId = pm.id;
  }, 30_000);

  it('客户买1000积分 → created→customer_paid→points_sent,积分原子到账', async () => {
    const ctx = { db: await getDb() };
    const db = ctx.db;

    // 1. 建采购单(内部自动分配代理 + 校验收款方式/最小量)
    const order = await createPurchaseOrder(ctx, {
      customerUserId: customerId,
      points: 1000,
      paymentMethodId: pmId,
      country: 'TH',
    });
    expect(order.status).toBe('created');
    expect(order.agentUserId).toBe(agentId);
    mainOrderId = order.id;

    // 2. 客户标记已付款
    const paid = await markPurchasePaid(ctx, { customerUserId: customerId, orderId: order.id });
    expect(paid.status).toBe('customer_paid');

    // 3. 代理确认收款 → 原子转积分给客户
    const sent = await confirmPurchaseAndTransfer(ctx, { agentUserId: agentId, orderId: order.id });
    expect(sent.status).toBe('points_sent');

    // 客户 +1000
    const cust = await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) });
    expect(cust?.balance).toBe(1000);
    // 代理 100000 - 1000 = 99000
    const ag = await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, agentId) });
    expect(ag?.balance).toBe(99_000);
    // 代理售出量累加
    const prof = await db.query.agentProfiles.findFirst({ where: eq(agentProfiles.userId, agentId) });
    expect(prof?.totalSoldPoints).toBe(1000);
    // 订单落了转账流水 id
    const ord = await db.query.pointPurchaseOrders.findFirst({ where: eq(pointPurchaseOrders.id, order.id) });
    expect(ord?.transferTxnId).toBeTruthy();
  });

  it('防双转:再次 confirm 已 points_sent 的单 → 抛冲突,不重复转积分', async () => {
    const ctx = { db: await getDb() };
    await expect(
      confirmPurchaseAndTransfer(ctx, { agentUserId: agentId, orderId: mainOrderId }),
    ).rejects.toThrow();
    // 客户余额仍是 1000(没被转第二次)
    const cust = await ctx.db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) });
    expect(cust?.balance).toBe(1000);
  });

  it('低于最小购买量 → 拒绝建单', async () => {
    const ctx = { db: await getDb() };
    await expect(
      createPurchaseOrder(ctx, { customerUserId: customerId, points: 50, paymentMethodId: pmId, country: 'TH' }),
    ).rejects.toThrow();
  });
});
