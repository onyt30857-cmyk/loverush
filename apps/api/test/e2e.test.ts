/**
 * E2E 主闭环测试 · Phase 8.1
 *
 * 闭环：
 *   1. seed 邀请码
 *   2. 注册客户 + 注册技师
 *   3. 技师完善档案（含定价）+ 审核通过
 *   4. 客户创建订单（DRAFT → PENDING_CONFIRM）
 *   5. 技师 confirm 锁价（→ LOCKED）
 *   6. 客户支付（→ PAID）
 *   7. 技师开始 → 完成
 *   8. 客户评价（→ REVIEWED + 写 reviews 表）
 *   9. 验证凭证链完整性
 *
 * 跑：
 *   DATABASE_URL=postgres://... JWT_SECRET=$(openssl rand -hex 32) \
 *     pnpm --filter @loverush/api test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists } from '@loverush/db';
import { api, getDb, registerNew, seedInviteCode, truncateAll } from './helpers';

describe('E2E · 完整业务闭环', () => {
  let customerToken: string;
  let customerId: string;
  let therapistToken: string;
  let therapistUserId: string;
  let therapistId: string;

  beforeAll(async () => {
    await truncateAll();
  }, 30_000);

  it('1. 注册客户', async () => {
    const r = await registerNew('customer');
    customerToken = r.access_token;
    customerId = r.user.id;
    expect(r.mnemonic.split(/\s+/)).toHaveLength(24);
  });

  it('2. 注册技师', async () => {
    const r = await registerNew('therapist');
    therapistToken = r.access_token;
    therapistUserId = r.user.id;
    expect(r.user.userType).toBe('therapist');
  });

  it('3. 技师完善档案', async () => {
    const res = await api.put(
      '/therapists/me',
      {
        bio: '专业按摩 8 年经验，温柔细致，注重客户体验',
        nationality: 'CN',
        serviceCity: 'Bangkok',
        heightCm: 168,
        weightKg: 50,
        bustCm: 88,
        hipCm: 90,
        bodyFatPct: 22,
        education: '本科',
        skillsJson: [
          { skill: '泰式', level: 5 },
          { skill: '精油', level: 4 },
        ],
        basePriceJson: [
          { duration: 60, pricePoints: 200 },
          { duration: 90, pricePoints: 280 },
        ],
        preferencesJson: { acceptableBehaviors: ['拥抱'], unacceptableBehaviors: ['触摸下身'] },
      },
      therapistToken,
    );
    expect(res.status).toBe(200);

    // 把 verification 强标 passed 跳过审核流程（e2e 不依赖人工审核员）
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, therapistUserId));
    const row = await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) });
    therapistId = row!.id;
  });

  it('4. 客户发现技师（推荐 API）', async () => {
    const res = await api.get<Array<{ therapist_id: string }>>('/assistant/recommend?top_n=10', customerToken);
    expect(res.status).toBe(200);
    expect(res.body.data?.length ?? 0).toBeGreaterThan(0);
    expect(res.body.data?.[0]?.therapist_id).toBe(therapistId);
  });

  it('5. 客户创建订单', async () => {
    const res = await api.post<{ id: string; status: string }>(
      '/orders',
      {
        therapist_id: therapistId,
        service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
      },
      customerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.status).toBe('DRAFT');

    const submit = await api.post<{ status: string }>(`/orders/${res.body.data!.id}/submit`, undefined, customerToken);
    expect(submit.body.data?.status).toBe('PENDING_CONFIRM');

    (globalThis as { __orderId?: string }).__orderId = res.body.data!.id;
  });

  it('6. 技师 confirm 锁价', async () => {
    const orderId = (globalThis as { __orderId?: string }).__orderId!;
    const res = await api.post<{ status: string; priceLockHash: string }>(
      `/orders/${orderId}/confirm`,
      undefined,
      therapistToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.status).toBe('LOCKED');
    expect(res.body.data?.priceLockHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('7. 客户支付', async () => {
    const orderId = (globalThis as { __orderId?: string }).__orderId!;

    // 先充值（stub）
    const rec = await api.post('/payments/recharge', { amount_usd_cents: 500 }, customerToken);
    expect(rec.status).toBe(200);

    const res = await api.post<{ status: string }>(
      `/orders/${orderId}/pay`,
      { payment_txn_id: `test_${Date.now()}` },
      customerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.status).toBe('PAID');
  });

  it('8. 技师开始服务 → 完成', async () => {
    const orderId = (globalThis as { __orderId?: string }).__orderId!;

    const start = await api.post<{ status: string }>(`/orders/${orderId}/start`, undefined, therapistToken);
    expect(start.body.data?.status).toBe('IN_SERVICE');

    const done = await api.post<{ status: string }>(`/orders/${orderId}/complete`, undefined, therapistToken);
    expect(done.body.data?.status).toBe('COMPLETED');
  });

  it('9. 客户评价（订单 + reviews 两条路径）', async () => {
    const orderId = (globalThis as { __orderId?: string }).__orderId!;

    const r = await api.post<{ status: string }>(`/orders/${orderId}/review`, { rating: 5, review: '很满意' }, customerToken);
    expect(r.body.data?.status).toBe('REVIEWED');

    const rev = await api.post(
      '/reviews',
      { order_id: orderId, score_service: 95, score_appearance: 90, content: '专业' },
      customerToken,
    );
    expect(rev.status).toBe(200);
  });

  it('10. 验证凭证链完整 + 事件齐全', async () => {
    const orderId = (globalThis as { __orderId?: string }).__orderId!;

    const chain = await api.get<Array<{ seq: number; event: string }>>(`/orders/${orderId}/chain`, customerToken);
    expect(chain.status).toBe(200);
    const events = chain.body.data!.map((e) => e.event);
    expect(events).toContain('order_created');
    expect(events).toContain('price_locked');
    expect(events).toContain('payment_received');
    expect(events).toContain('service_started');
    expect(events).toContain('service_completed');
    expect(events).toContain('review_submitted');

    const verify = await api.get<{ valid: boolean }>(`/orders/${orderId}/chain/verify`, customerToken);
    expect(verify.body.data?.valid).toBe(true);
  });
});

describe('E2E · 派单广播 + 抢占式 accept', () => {
  let customerToken: string;
  let therapistA: { token: string; userId: string };
  let therapistB: { token: string; userId: string };
  let therapistAId: string;
  let therapistBId: string;
  let orderId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    customerToken = c.access_token;

    const a = await registerNew('therapist');
    const b = await registerNew('therapist');
    therapistA = { token: a.access_token, userId: a.user.id };
    therapistB = { token: b.access_token, userId: b.user.id };

    // 两个技师都完善档案 + 标 passed
    for (const t of [therapistA, therapistB]) {
      await api.put(
        '/therapists/me',
        {
          bio: '一段 bio'.repeat(5),
          serviceCity: 'Bangkok',
          basePriceJson: [{ duration: 60, pricePoints: 200 }],
        },
        t.token,
      );
    }
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, therapistA.userId));
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, therapistB.userId));
    therapistAId = (await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistA.userId) }))!.id;
    therapistBId = (await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistB.userId) }))!.id;
  }, 30_000);

  it('客户创建订单 + 派单广播 → A/B 都收到 offer', async () => {
    const order = await api.post<{ id: string }>(
      '/orders',
      {
        therapist_id: therapistAId,
        service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
      },
      customerToken,
    );
    orderId = order.body.data!.id;

    const dispatch = await api.post<unknown[]>(`/orders/${orderId}/dispatch`, { fanout: 5 }, customerToken);
    expect(dispatch.body.data?.length ?? 0).toBeGreaterThanOrEqual(2);

    const aOffers = await api.get<Array<{ id: string }>>('/me/offers', therapistA.token);
    const bOffers = await api.get<Array<{ id: string }>>('/me/offers', therapistB.token);
    expect(aOffers.body.data!.length).toBeGreaterThan(0);
    expect(bOffers.body.data!.length).toBeGreaterThan(0);
  });

  it('A 先 accept → B 的 offer 变 superseded', async () => {
    const aOffers = await api.get<Array<{ id: string }>>('/me/offers', therapistA.token);
    const aOfferId = aOffers.body.data![0]!.id;

    const accept = await api.post<{ offer: { status: string }; order: { status: string; therapistUserId: string } }>(
      `/me/offers/${aOfferId}/accept`,
      undefined,
      therapistA.token,
    );
    expect(accept.body.data?.offer.status).toBe('accepted');
    expect(accept.body.data?.order.status).toBe('PENDING_CONFIRM');
    expect(accept.body.data?.order.therapistUserId).toBe(therapistA.userId);

    // B 再 accept 应该失败（offer 已经 superseded）
    const bOffers = await api.get<Array<{ id: string }>>('/me/offers', therapistB.token);
    expect(bOffers.body.data!.length).toBe(0); // 已不在 pending 列表
  });
});

describe('E2E · 一键封锁 + 推荐排除', () => {
  it('封锁后该技师不再出现在推荐里', async () => {
    await truncateAll();
    const c = await registerNew('customer');
    const t = await registerNew('therapist');

    await api.put(
      '/therapists/me',
      { bio: 'xxxxxxxxxxxxxxxxxxxx', serviceCity: 'Bangkok', basePriceJson: [{ duration: 60, pricePoints: 200 }] },
      t.access_token,
    );
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, t.user.id));

    // 推荐里应有
    let rec = await api.get<unknown[]>('/assistant/recommend?top_n=10', c.access_token);
    expect(rec.body.data!.length).toBeGreaterThan(0);

    // 封锁
    await api.post('/me/blocks', { target_user_id: t.user.id }, c.access_token);

    // 推荐里应没有
    rec = await api.get<unknown[]>('/assistant/recommend?top_n=10', c.access_token);
    expect(rec.body.data!.length).toBe(0);
  });
});

describe('E2E · 翻译网关 + 缓存命中', () => {
  it('同句重复翻译第二次命中缓存', async () => {
    await truncateAll();
    const c = await registerNew('customer');

    const r1 = await api.post<{ provider: string; cached: boolean }>(
      '/translate',
      { text: '你好，今晚有空吗？', src_lang: 'zh', tgt_lang: 'en' },
      c.access_token,
    );
    // 没有 ANTHROPIC_API_KEY 时会 fail，所以这条 case 不强校验 cached，只校验 status
    if (r1.status === 200) {
      const r2 = await api.post<{ cached: boolean }>(
        '/translate',
        { text: '你好，今晚有空吗？', src_lang: 'zh', tgt_lang: 'en' },
        c.access_token,
      );
      expect(r2.body.data?.cached).toBe(true);
    } else {
      // LLM 凭证缺失 → skip
      expect(r1.status).toBeGreaterThanOrEqual(400);
    }
  });
});
