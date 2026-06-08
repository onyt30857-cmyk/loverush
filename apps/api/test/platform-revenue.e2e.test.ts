/**
 * 平台收入记账 e2e · platform_revenue
 *
 * 验证抽成差额真正入账(此前蒸发不可对账):走一笔陪聊扣费 → 平台收入记一条 30% 差额;
 * (source,refId) 幂等不重复记;技师分成/客户扣费金额不受影响(只多记一行平台收入)。
 *
 * 跑：cd apps/api && DATABASE_URL=...loverush_test pnpm exec vitest run test/platform-revenue.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { platformRevenue, pointsAccount } from '@loverush/db';
import { getDb, registerNew, truncateAll, creditPointsForTest } from './helpers';
import { startChatSession } from '../src/services/chatPass';

describe('平台收入记账 · platform_revenue', () => {
  let customerId: string;
  let therapistUserId: string;

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    customerId = c.user.id;
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    await creditPointsForTest(customerId, 2000);
  }, 30_000);

  it('买30分钟陪聊 → 平台收入记一条 30% 差额(500付,技师350,平台150)', async () => {
    const ctx = { db: await getDb() };
    await startChatSession(ctx, { customerId, therapistUserId, durationMinutes: 30 });

    const rows = await ctx.db.query.platformRevenue.findMany({
      where: eq(platformRevenue.source, 'chat_pass'),
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.amount).toBe(150); // 500 - 350(70%) = 150
    expect(rows[0]!.therapistUserId).toBe(therapistUserId);
    expect(rows[0]!.customerUserId).toBe(customerId);

    // 回归:技师分成仍是 350、客户扣了 500(平台记账不影响主交易)
    const ther = await ctx.db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, therapistUserId) });
    expect(ther?.balance).toBe(350);
    const cust = await ctx.db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) });
    expect(cust?.balance).toBe(1500); // 2000 - 500
  });

  it('幂等:同 idempotencyKey 再买 → 平台收入不重复记', async () => {
    const ctx = { db: await getDb() };
    const key = 'idem-platform-rev-1';
    await startChatSession(ctx, { customerId, therapistUserId, durationMinutes: 30, idempotencyKey: key });
    // 同 key 再调(debit 幂等不重复扣;platform_revenue (source,refId) 唯一不重复记)
    await startChatSession(ctx, { customerId, therapistUserId, durationMinutes: 30, idempotencyKey: key }).catch(() => {});

    const rows = await ctx.db.query.platformRevenue.findMany({
      where: eq(platformRevenue.refId, `chatpass.${key}`),
    });
    expect(rows.length).toBe(1); // 只记一次
  });
});
