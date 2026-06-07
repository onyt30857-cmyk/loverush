/**
 * E2E · M19 钱包 /me/wallet + 流水 /me/transactions · 需 loverush_test
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/me-transactions.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pointsAccount, pointsTransaction } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';

interface Wallet { balance: number; frozen: number; totalIn: number; totalOut: number }
interface Txn {
  id: string; type: string; direction: 'IN' | 'OUT'; amount: number;
  balanceAfter: number; description: string | null; orderNo: string | null; createdAt: string;
}

let token = '';
let userId = '';

describe('M19 钱包 + 流水明细', () => {
  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    token = c.access_token;
    userId = c.user.id;
    const db = await getDb();
    // registerNew 已自动建账户 → 用 update 覆盖成已知值
    await db
      .update(pointsAccount)
      .set({ balance: 700, frozen: 200, totalIn: 1200, totalOut: 500 })
      .where(eq(pointsAccount.userId, userId));
    // 三笔流水:充值(IN) → 陪聊消费(OUT) → 订单冻结(OUT)
    await db.insert(pointsTransaction).values([
      { userId, type: 'RECHARGE', direction: 'IN', amount: 1000, balanceAfter: 1000, description: '充值', createdAt: new Date(Date.now() - 30000) },
      { userId, type: 'CHAT_SPEND', direction: 'OUT', amount: 50, balanceAfter: 950, description: '陪聊消费', createdAt: new Date(Date.now() - 20000) },
      { userId, type: 'FROZEN', direction: 'OUT', amount: 200, balanceAfter: 750, description: '订单冻结', createdAt: new Date(Date.now() - 10000) },
    ]);
  });

  it('GET /me/wallet 返回余额聚合', async () => {
    const res = await api.get<Wallet>('/me/wallet', token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ balance: 700, frozen: 200, totalIn: 1200, totalOut: 500 });
  });

  it('GET /me/transactions 倒序返回全部流水', async () => {
    const res = await api.get<{ items: Txn[]; hasMore: boolean }>('/me/transactions', token);
    expect(res.status).toBe(200);
    const items = res.body.data!.items;
    expect(items).toHaveLength(3);
    // 倒序:最新的 FROZEN 在前
    expect(items[0]!.type).toBe('FROZEN');
    expect(items[2]!.type).toBe('RECHARGE');
    expect(res.body.data!.hasMore).toBe(false);
  });

  it('direction=IN 只返回收入', async () => {
    const res = await api.get<{ items: Txn[] }>('/me/transactions?direction=IN', token);
    expect(res.status).toBe(200);
    const items = res.body.data!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('RECHARGE');
    expect(items[0]!.direction).toBe('IN');
  });

  it('分页:limit=2 返回 hasMore=true', async () => {
    const res = await api.get<{ items: Txn[]; hasMore: boolean }>('/me/transactions?limit=2&offset=0', token);
    expect(res.body.data!.items).toHaveLength(2);
    expect(res.body.data!.hasMore).toBe(true);
  });

  it('未登录 401', async () => {
    const res = await api.get('/me/transactions');
    expect(res.status).toBe(401);
  });

  it('新用户无账户 → wallet 全 0(不报错)', async () => {
    const fresh = await registerNew('customer');
    const res = await api.get<Wallet>('/me/wallet', fresh.access_token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ balance: 0, frozen: 0, totalIn: 0, totalOut: 0 });
  });
});
