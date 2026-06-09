/**
 * E2E · 技师管控 · listAllTherapists + decideVerification(含 passed→reject 撤下)
 *
 * 跑：
 *   DATABASE_URL=postgresql://loverush:$PASS@localhost:54399/loverush_test \
 *   JWT_SECRET=test-secret-32-chars-minimum!! \
 *   cd apps/api && ./node_modules/.bin/vitest run test/therapist-moderation.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, userRoles } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';

describe('技师管控 · listAllTherapists + decideVerification 撤下', () => {
  let adminToken: string;
  let adminId: string;

  // 三个技师：pending / passed / failed
  let pendingUserId: string;
  let passedUserId: string;
  let failedUserId: string;

  beforeAll(async () => {
    await truncateAll();

    // 注册 admin
    const a = await registerNew('customer');
    adminToken = a.access_token;
    adminId = a.user.id;
    const db = await getDb();
    await db.insert(userRoles).values({ userId: adminId, role: 'admin' });

    // 注册三个技师 + PUT /therapists/me 建 therapists 行
    const mkTherapist = async (status: 'pending' | 'passed' | 'failed') => {
      const t = await registerNew('therapist');
      // 建 therapists 行（verificationStatus 默认 pending）
      await api.put(
        '/therapists/me',
        {
          bio: `${status}-test`,
          service_country: 'TH',
          service_city: 'bangkok',
        },
        t.access_token,
      );
      if (status !== 'pending') {
        const db2 = await getDb();
        await db2
          .update(therapists)
          .set({ verificationStatus: status })
          .where(eq(therapists.userId, t.user.id));
      }
      return t.user.id;
    };

    pendingUserId = await mkTherapist('pending');
    passedUserId = await mkTherapist('passed');
    failedUserId = await mkTherapist('failed');
  }, 60_000);

  // ─── listAllTherapists ───────────────────────────────────────────────────

  it('GET /admin/therapists/list 无筛选返回全部 3 个技师', async () => {
    const res = await api.get<{ rows: unknown[]; total: number }>(
      '/admin/therapists/list?status=all',
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data?.rows.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /admin/therapists/list?status=passed 只返回已通过', async () => {
    const res = await api.get<{ rows: Array<{ user_id: string; verification_status: string }>; total: number }>(
      '/admin/therapists/list?status=passed',
      adminToken,
    );
    expect(res.status).toBe(200);
    const rows = res.body.data?.rows ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // 所有行都是 passed
    for (const r of rows) {
      expect(r.verification_status).toBe('passed');
    }
    // passedUserId 在列表中
    expect(rows.some((r) => r.user_id === passedUserId)).toBe(true);
  });

  it('GET /admin/therapists/list?status=pending 只返回 pending+in_review', async () => {
    // 注册新技师并手动设为 pending（注册 + PUT 可能触发 in_review，两者都属于「待审」）
    const fresh = await registerNew('therapist');
    await api.put('/therapists/me', { bio: 'fresh-pending', service_country: 'TH', service_city: 'bangkok' }, fresh.access_token);
    // 强制置 pending，确保 status=pending 查询能捞到
    const db = await getDb();
    await db
      .update(therapists)
      .set({ verificationStatus: 'pending' })
      .where(eq(therapists.userId, fresh.user.id));

    const res = await api.get<{ rows: Array<{ user_id: string; verification_status: string }>; total: number }>(
      '/admin/therapists/list?status=pending',
      adminToken,
    );
    expect(res.status).toBe(200);
    const rows = res.body.data?.rows ?? [];
    for (const r of rows) {
      expect(['pending', 'in_review']).toContain(r.verification_status);
    }
    expect(rows.some((r) => r.user_id === fresh.user.id)).toBe(true);
  });

  it('GET /admin/therapists/list?status=failed 只返回已驳回', async () => {
    const res = await api.get<{ rows: Array<{ user_id: string; verification_status: string }>; total: number }>(
      '/admin/therapists/list?status=failed',
      adminToken,
    );
    expect(res.status).toBe(200);
    const rows = res.body.data?.rows ?? [];
    for (const r of rows) {
      expect(r.verification_status).toBe('failed');
    }
    expect(rows.some((r) => r.user_id === failedUserId)).toBe(true);
  });

  it('GET /admin/therapists/list 支持昵称搜索（q=）', async () => {
    // 注册一个特殊昵称技师
    const special = await registerNew('therapist');
    await api.put('/therapists/me', { bio: 'uniqueNicknameForSearch', service_country: 'TH', service_city: 'bangkok' }, special.access_token);
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'pending' }).where(eq(therapists.userId, special.user.id));

    // 搜到
    const res = await api.get<{ rows: Array<{ user_id: string }>; total: number }>(
      `/admin/therapists/list?status=all&q=${encodeURIComponent(special.user.displayName ?? '')}`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const rows = res.body.data?.rows ?? [];
    expect(rows.some((r) => r.user_id === special.user.id)).toBe(true);
  });

  it('非 admin 访问 /admin/therapists/list 被拒 403', async () => {
    const normal = await registerNew('customer');
    const res = await api.get('/admin/therapists/list?status=all', normal.access_token);
    expect(res.status).toBe(403);
  });

  // ─── decideVerification · 撤下 passed 技师 ───────────────────────────────

  it('POST /admin/therapists/:userId/verify reject 可将 passed 技师置为 failed（撤下）', async () => {
    const db = await getDb();

    // 确认目前是 passed
    const before = await db.query.therapists.findFirst({ where: eq(therapists.userId, passedUserId) });
    expect(before?.verificationStatus).toBe('passed');

    // 撤下
    const res = await api.post(
      `/admin/therapists/${passedUserId}/verify`,
      { decision: 'reject', reason: '测试撤下：主动置 failed' },
      adminToken,
    );
    expect(res.status).toBe(200);
    expect((res.body.data as { verificationStatus: string } | undefined)?.verificationStatus).toBe('failed');

    // 验证数据库已变为 failed
    const after = await db.query.therapists.findFirst({ where: eq(therapists.userId, passedUserId) });
    expect(after?.verificationStatus).toBe('failed');

    // 撤下后不出现在 passed 列表
    const listRes = await api.get<{ rows: Array<{ user_id: string }> }>(
      '/admin/therapists/list?status=passed',
      adminToken,
    );
    const rows = listRes.body.data?.rows ?? [];
    expect(rows.some((r) => r.user_id === passedUserId)).toBe(false);
  });

  // ─── batch-verify ────────────────────────────────────────────────────────

  it('POST /admin/therapists/batch-verify 批量通过多个技师', async () => {
    const db = await getDb();

    // 注册两个技师
    const t1 = await registerNew('therapist');
    const t2 = await registerNew('therapist');
    await api.put('/therapists/me', { bio: 'b1', service_country: 'TH', service_city: 'bangkok' }, t1.access_token);
    await api.put('/therapists/me', { bio: 'b2', service_country: 'TH', service_city: 'bangkok' }, t2.access_token);

    const res = await api.post(
      '/admin/therapists/batch-verify',
      {
        therapist_user_ids: [t1.user.id, t2.user.id],
        decision: 'approve',
      },
      adminToken,
    );
    expect(res.status).toBe(200);
    const batchData = res.body.data as { succeeded: string[]; failed: unknown[] } | undefined;
    expect(batchData?.succeeded).toHaveLength(2);
    expect(batchData?.failed).toHaveLength(0);

    // 验证数据库已变为 passed
    const r1 = await db.query.therapists.findFirst({ where: eq(therapists.userId, t1.user.id) });
    const r2 = await db.query.therapists.findFirst({ where: eq(therapists.userId, t2.user.id) });
    expect(r1?.verificationStatus).toBe('passed');
    expect(r2?.verificationStatus).toBe('passed');
  });

  it('POST /admin/therapists/batch-verify 批量驳回需提供 reason', async () => {
    const t3 = await registerNew('therapist');
    await api.put('/therapists/me', { bio: 'b3', service_country: 'TH', service_city: 'bangkok' }, t3.access_token);

    const res = await api.post(
      '/admin/therapists/batch-verify',
      {
        therapist_user_ids: [t3.user.id],
        decision: 'reject',
        reason: '批量驳回测试原因',
      },
      adminToken,
    );
    expect(res.status).toBe(200);
    const batchData2 = res.body.data as { succeeded: string[] } | undefined;
    expect(batchData2?.succeeded).toHaveLength(1);

    const db = await getDb();
    const r = await db.query.therapists.findFirst({ where: eq(therapists.userId, t3.user.id) });
    expect(r?.verificationStatus).toBe('failed');
  });
});
