/**
 * E2E · M19 P2 关键资金事件通知 · 需 loverush_test
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/wallet-notify.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { notifications } from '@loverush/db';
import { credit, debit } from '../src/services/points';
import { getDb, truncateAll, registerNew, sleep } from './helpers';

async function walletNotifs(userId: string) {
  const db = await getDb();
  return db.query.notifications.findMany({
    where: and(eq(notifications.recipientUserId, userId), eq(notifications.category, 'wallet')),
  });
}

describe('M19 P2 资金事件通知', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  it('白名单事件(RECHARGE)发 wallet 通知,文案带金额+余额', async () => {
    const db = await getDb();
    const u = (await registerNew('customer')).user.id;
    await credit({ db }, { userId: u, type: 'RECHARGE', amount: 500, description: '充值' });
    await sleep(400);
    const ns = await walletNotifs(u);
    expect(ns).toHaveLength(1);
    expect(ns[0]!.title).toBe('充值到账');
    expect(ns[0]!.body).toContain('+500');
    expect(ns[0]!.deepLink).toBe('/me/wallet');
  });

  it('高频小额(CHAT_SPEND / ADJUSTMENT)不发 wallet 通知', async () => {
    const db = await getDb();
    const u = (await registerNew('customer')).user.id;
    await credit({ db }, { userId: u, type: 'ADJUSTMENT', amount: 1000 }); // 非白名单,不通知
    await debit({ db }, { userId: u, type: 'CHAT_SPEND', amount: 50 }); // 非白名单,不通知
    await sleep(400);
    const ns = await walletNotifs(u);
    expect(ns).toHaveLength(0);
  });

  it('幂等重放不重复通知', async () => {
    const db = await getDb();
    const u = (await registerNew('customer')).user.id;
    const key = `recharge.test.${u}`;
    await credit({ db }, { userId: u, type: 'RECHARGE', amount: 200, idempotencyKey: key });
    await credit({ db }, { userId: u, type: 'RECHARGE', amount: 200, idempotencyKey: key }); // 重放
    await sleep(400);
    const ns = await walletNotifs(u);
    expect(ns).toHaveLength(1);
  });

  it('提现(WITHDRAW · 出账)也通知,文案带负号', async () => {
    const db = await getDb();
    const u = (await registerNew('customer')).user.id;
    await credit({ db }, { userId: u, type: 'ADJUSTMENT', amount: 1000 }); // 先有余额(不通知)
    await debit({ db }, { userId: u, type: 'WITHDRAW', amount: 300, description: '提现' });
    await sleep(400);
    const ns = await walletNotifs(u);
    expect(ns).toHaveLength(1);
    expect(ns[0]!.title).toBe('提现已处理');
    expect(ns[0]!.body).toContain('-300');
  });
});
