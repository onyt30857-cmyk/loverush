/**
 * E2E · 积分回收冻结担保状态机（M16 P1）· 需 loverush_test
 *
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/redeem.e2e.test.ts
 *
 * rate=8000(80%)；回收 100 积分 → payout=100×0.8×$0.01=$0.80。
 * 资金:发起 debit(FROZEN) holder 1000→900；完成 credit agent +100；取消/超时 credit holder 退回。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, pointsAccount, agentProfiles, pointRedeemOrders } from '@loverush/db';
import {
  initiateRedeem,
  agentAcceptRedeem,
  agentMarkPaid,
  holderConfirmRedeem,
  cancelRedeem,
  openRedeemDispute,
  adminResolveRedeem,
  autoConfirmPaidRedeems,
  expireStaleRedeems,
} from '../src/services/redeem';
import { getDb, truncateAll } from './helpers';

let holderId: string;
let agentId: string;
const PM = { payoutMethodType: 'usdt_trc20', payoutMethodFields: { address: 'TxTest123' } };

async function mkUser(name: string): Promise<string> {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({
      userType: 'customer',
      status: 'active',
      displayName: name,
      bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}`,
    })
    .returning();
  return u!.id;
}
async function setBal(userId: string, b: number) {
  const db = await getDb();
  await db
    .insert(pointsAccount)
    .values({ userId, balance: b, frozen: 0 })
    .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: b, frozen: 0 } });
}
async function bal(userId: string): Promise<number> {
  const db = await getDb();
  return (await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) }))?.balance ?? -1;
}
async function rstatus(id: string): Promise<string | undefined> {
  const db = await getDb();
  return (await db.query.pointRedeemOrders.findFirst({ where: eq(pointRedeemOrders.id, id) }))?.status;
}
async function ctx() {
  return { db: await getDb() };
}

describe('E2E · 积分回收冻结担保', () => {
  beforeAll(async () => {
    await truncateAll();
    holderId = await mkUser('Holder');
    agentId = await mkUser('Agent');
    const db = await getDb();
    await db
      .insert(agentProfiles)
      .values({ userId: agentId, status: 'active', redeemEnabled: true, redeemRateBps: 8000 } as never);
  }, 30_000);

  it('完整成功:发起冻结 → 接单 → 付款 → 持有人确认释放给代理', async () => {
    await setBal(holderId, 1000);
    await setBal(agentId, 0);
    const o = await initiateRedeem(await ctx(), { holderUserId: holderId, points: 100, ...PM });
    expect(await bal(holderId)).toBe(900); // 冻结扣 100
    expect(o.payoutAmount).toBe('0.80'); // 100×80%×$0.01
    await agentAcceptRedeem(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await agentMarkPaid(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await holderConfirmRedeem(await ctx(), { holderUserId: holderId, redeemId: o.id });
    expect(await bal(agentId)).toBe(100); // 积分到代理库存
    expect(await bal(holderId)).toBe(900); // 持有人不退(已变现)
    expect(await rstatus(o.id)).toBe('completed');
  });

  it('取消 → 解冻退回持有人', async () => {
    await setBal(holderId, 1000);
    await setBal(agentId, 0);
    const o = await initiateRedeem(await ctx(), { holderUserId: holderId, points: 100, ...PM });
    expect(await bal(holderId)).toBe(900);
    await cancelRedeem(await ctx(), { redeemId: o.id, actorUserId: holderId });
    expect(await bal(holderId)).toBe(1000); // 还原
    expect(await rstatus(o.id)).toBe('cancelled');
  });

  it('争议 → admin 释放给代理', async () => {
    await setBal(holderId, 1000);
    await setBal(agentId, 0);
    const o = await initiateRedeem(await ctx(), { holderUserId: holderId, points: 100, ...PM });
    await agentAcceptRedeem(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await agentMarkPaid(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await openRedeemDispute(await ctx(), { userId: holderId, redeemId: o.id });
    expect(await rstatus(o.id)).toBe('disputed');
    await adminResolveRedeem(await ctx(), { redeemId: o.id, resolution: 'release_to_agent' });
    expect(await bal(agentId)).toBe(100);
    expect(await rstatus(o.id)).toBe('completed');
  });

  it('争议 → admin 退回持有人', async () => {
    await setBal(holderId, 1000);
    await setBal(agentId, 0);
    const o = await initiateRedeem(await ctx(), { holderUserId: holderId, points: 100, ...PM });
    await agentAcceptRedeem(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await agentMarkPaid(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await openRedeemDispute(await ctx(), { userId: holderId, redeemId: o.id });
    await adminResolveRedeem(await ctx(), { redeemId: o.id, resolution: 'refund_holder' });
    expect(await bal(holderId)).toBe(1000); // 还原
    expect(await bal(agentId)).toBe(0); // 代理没拿到
    expect(await rstatus(o.id)).toBe('cancelled');
  });

  it('超时(created 7天+)→ 解冻退回持有人', async () => {
    await setBal(holderId, 1000);
    await setBal(agentId, 0);
    const o = await initiateRedeem(await ctx(), { holderUserId: holderId, points: 100, ...PM });
    const db = await getDb();
    await db
      .update(pointRedeemOrders)
      .set({ createdAt: new Date(Date.now() - 8 * 86400_000) })
      .where(eq(pointRedeemOrders.id, o.id));
    const n = await expireStaleRedeems(await ctx());
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await bal(holderId)).toBe(1000);
    expect(await rstatus(o.id)).toBe('expired');
  });

  it('24h 自动确认:付款后超时 → 自动释放给代理', async () => {
    await setBal(holderId, 1000);
    await setBal(agentId, 0);
    const o = await initiateRedeem(await ctx(), { holderUserId: holderId, points: 100, ...PM });
    await agentAcceptRedeem(await ctx(), { agentUserId: agentId, redeemId: o.id });
    await agentMarkPaid(await ctx(), { agentUserId: agentId, redeemId: o.id });
    const db = await getDb();
    await db
      .update(pointRedeemOrders)
      .set({ agentPaidAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(pointRedeemOrders.id, o.id));
    await autoConfirmPaidRedeems(await ctx());
    expect(await bal(agentId)).toBe(100);
    expect(await rstatus(o.id)).toBe('completed');
  });
});
