/**
 * M18 心动陪伴 e2e
 *
 * 主干：注册 customer+therapist → 充值 → seed voice_whisper →
 *   POST /companion/:therapistUserId/action → 校验计费(-30)/分成(+21,70%)/亲密度(exp=15)
 * 余额不足：无钱 customer 发起 → 400
 *
 * 跑：
 *   cd apps/api
 *   TEST_URL=...loverush_test  DATABASE_URL=$TEST_URL pnpm exec vitest run test/companion.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { companionActions, intimacy, pointsAccount } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';
import { resolveReplyTier } from '../src/services/ai_alter';
import { levelForExp } from '../src/services/companion';

describe('M18 心动陪伴 · companion', () => {
  let customerToken: string;
  let customerId: string;
  let therapistUserId: string;

  beforeAll(async () => {
    await truncateAll();

    const db = await getDb();
    // truncate 清掉了 companion_actions seed，这里重新塞一条
    await db
      .insert(companionActions)
      .values({
        code: 'voice_whisper',
        actionType: 'voice',
        pricePoints: 30,
        revenueShareBps: 7000,
        expReward: 15,
        isActive: 1,
      })
      .onConflictDoNothing();

    const customer = await registerNew('customer');
    customerToken = customer.access_token;
    customerId = customer.user.id;

    const therapist = await registerNew('therapist');
    therapistUserId = therapist.user.id;

    // 给客户充值（stub，500 cents = 500 积分）
    const rec = await api.post('/payments/recharge', { amount_usd_cents: 500 }, customerToken);
    expect(rec.status).toBe(200);
  }, 30_000);

  it('主干：发起 voice_whisper → 计费+分成+亲密度', async () => {
    const res = await api.post<{ action: string; pricePoints: number; intimacyExp: number }>(
      `/companion/${therapistUserId}/action`,
      { action_code: 'voice_whisper' },
      customerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.action).toBe('voice_whisper');
    expect(res.body.data?.pricePoints).toBe(30);
    expect(res.body.data?.intimacyExp).toBe(15);

    const db = await getDb();

    // 客户余额 500 - 30 = 470
    const custAcc = await db.query.pointsAccount.findFirst({
      where: eq(pointsAccount.userId, customerId),
    });
    expect(custAcc?.balance).toBe(470);

    // 技师分成 floor(30 * 7000 / 10000) = 21
    const therAcc = await db.query.pointsAccount.findFirst({
      where: eq(pointsAccount.userId, therapistUserId),
    });
    expect(therAcc?.balance).toBe(21);

    // 亲密度 exp = 15
    const inti = await db.query.intimacy.findFirst({
      where: and(
        eq(intimacy.customerId, customerId),
        eq(intimacy.therapistUserId, therapistUserId),
      ),
    });
    expect(inti?.exp).toBe(15);
  });

  it('付费动作返回她的回复字段 + level', async () => {
    const r = await api.post<{ level: number; reply: string | null }>(
      `/companion/${therapistUserId}/action`,
      { action_code: 'voice_whisper' },
      customerToken,
    );
    expect(r.status).toBe(200);
    expect(typeof r.body.data?.level).toBe('number');
    expect('reply' in (r.body.data ?? {})).toBe(true); // 无 LLM key 时兜底,断言字段存在
  });

  it('幂等：同 idempotency_key 连发两次 → 只扣一次心动值', async () => {
    const u = await registerNew('customer');
    await api.post('/payments/recharge', { amount_usd_cents: 100 }, u.access_token);
    const db = await getDb();
    const before = (await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, u.user.id) }))?.balance ?? 0;

    const key = `test-idem-${u.user.id}`;
    const r1 = await api.post(`/companion/${therapistUserId}/action`, { action_code: 'voice_whisper', idempotency_key: key }, u.access_token);
    const r2 = await api.post(`/companion/${therapistUserId}/action`, { action_code: 'voice_whisper', idempotency_key: key }, u.access_token);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const after = (await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, u.user.id) }))?.balance ?? 0;
    expect(before - after).toBe(30); // 只扣一次 30，不是 60
  });

  it('余额不足：无钱 customer 发起 → 400', async () => {
    const broke = await registerNew('customer');
    const res = await api.post(
      `/companion/${therapistUserId}/action`,
      { action_code: 'voice_whisper' },
      broke.access_token,
    );
    expect(res.status).toBe(400);
  });
});

describe('M18 · 模型分层', () => {
  it('免费闲聊 → T2', () => { expect(resolveReplyTier({ scene: 'free_chat' })).toBe('T2'); });
  it('付费亲密动作 → T1', () => { expect(resolveReplyTier({ scene: 'paid_action' })).toBe('T1'); });
});

describe('M18 P2 · 亲密度等级', () => {
  it.each([[0,0],[49,0],[50,1],[149,1],[150,2],[349,2],[350,3],[699,3],[700,4],[5000,4]])(
    'exp=%i → level=%i', (exp, lvl) => { expect(levelForExp(exp)).toBe(lvl); });
});
