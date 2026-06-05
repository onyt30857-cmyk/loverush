/**
 * 陪聊付费服务 e2e
 *
 *   checkChatAccess：新客 free + remaining 10 → 消耗满 → 软墙(not allowed) → 买 session → allowed(session)
 *   startChatSession(路由)：扣客户积分 + 技师分成 70% + 建倒计时 session
 *   余额不足 → E2010
 *
 * 跑：cd apps/api && pnpm exec vitest run test/chat-pass.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pointsAccount } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';
import { checkChatAccess, consumeFreeQuota, FREE_DAILY_QUOTA } from '../src/services/chatPass';

describe('陪聊付费 · checkChatAccess + 免费额度', () => {
  let customerId: string;
  let therapistUserId: string;
  let customerToken: string;

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    customerId = c.user.id;
    customerToken = c.access_token;
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    // 充值 1000 积分
    const rec = await api.post('/payments/recharge', { amount_usd_cents: 1000 }, customerToken);
    expect(rec.status).toBe(200);
  }, 30_000);

  it('新客 → 免费额度可用(source=free, remaining=10)', async () => {
    const db = await getDb();
    const access = await checkChatAccess({ db }, { customerId, therapistUserId });
    expect(access.allowed).toBe(true);
    expect(access.source).toBe('free');
    expect(access.remaining).toBe(FREE_DAILY_QUOTA);
  });

  it('消耗满每日免费额度 → 软墙(not allowed)', async () => {
    const db = await getDb();
    for (let i = 0; i < FREE_DAILY_QUOTA; i++) {
      await consumeFreeQuota({ db }, { customerId, therapistUserId });
    }
    const access = await checkChatAccess({ db }, { customerId, therapistUserId });
    expect(access.allowed).toBe(false);
    expect(access.source).toBe('none');
  });

  it('买 30 分钟陪聊时段 → 扣 500 + 技师 +350 + access=session', async () => {
    const res = await api.post<{ expireAt: string; durationMinutes: number }>(
      `/chat-pass/${therapistUserId}/session`,
      { duration_minutes: 30 },
      customerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.durationMinutes).toBe(30);
    expect(typeof res.body.data?.expireAt).toBe('string');

    const db = await getDb();
    // 客户 1000 - 500 = 500
    const cust = await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, customerId) });
    expect(cust?.balance).toBe(500);
    // 技师分成 500 * 70% = 350
    const ther = await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, therapistUserId) });
    expect(ther?.balance).toBe(350);

    // 软墙解除:有 session → allowed(source=session)
    const access = await checkChatAccess({ db }, { customerId, therapistUserId });
    expect(access.allowed).toBe(true);
    expect(access.source).toBe('session');
    expect(access.expireAt).toBeInstanceOf(Date);
  });

  it('余额不足买 60 分钟(900>500) → E2010', async () => {
    const res = await api.post(
      `/chat-pass/${therapistUserId}/session`,
      { duration_minutes: 60 },
      customerToken,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('E2010');
  });
});
