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
