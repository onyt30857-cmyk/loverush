/**
 * E2E for Phase 9.x · admin 角色 / Stripe 降级 / /me / R2 stub
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, userRoles } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';

describe('E2E · Admin 角色拦截 (D-103)', () => {
  let normalUser: { token: string; id: string };
  let adminUser: { token: string; id: string };

  beforeAll(async () => {
    await truncateAll();
    const u = await registerNew('customer');
    normalUser = { token: u.access_token, id: u.user.id };

    const a = await registerNew('customer');
    adminUser = { token: a.access_token, id: a.user.id };

    // 给 adminUser 赋 admin 角色
    const db = await getDb();
    await db.insert(userRoles).values({ userId: adminUser.id, role: 'admin' });
  }, 30_000);

  it('普通用户访问 /admin/dashboard 应被拒（403）', async () => {
    const res = await api.get('/admin/dashboard', normalUser.token);
    expect(res.status).toBe(403);
  });

  it('普通用户访问 /admin/audit/queue 应被拒（403）', async () => {
    const res = await api.get('/admin/audit/queue', normalUser.token);
    expect(res.status).toBe(403);
  });

  it('admin 用户访问 /admin/dashboard 通过', async () => {
    const res = await api.get('/admin/dashboard', adminUser.token);
    expect(res.status).toBe(200);
  });

  it('admin 用户给其他人赋 cs 角色', async () => {
    const target = await registerNew('customer');
    const res = await api.post(
      '/admin/roles',
      { user_id: target.user.id, role: 'cs' },
      adminUser.token,
    );
    expect(res.status).toBe(200);

    // target 现在可以访问 cs 域路由
    const ticketAccess = await api.get('/admin/tickets', target.access_token);
    expect(ticketAccess.status).toBe(200);
  });

  it('未登录访问 admin 路由 401', async () => {
    const res = await api.get('/admin/dashboard');
    expect(res.status).toBe(401);
  });
});

describe('E2E · /me 接口 (D-201/202)', () => {
  let customerUser: { token: string; id: string };
  let therapistUser: { token: string; id: string };

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    const t = await registerNew('therapist');
    customerUser = { token: c.access_token, id: c.user.id };
    therapistUser = { token: t.access_token, id: t.user.id };

    // 给 therapist 完善档案 + 标 passed
    await api.put('/therapists/me', { bio: 'x'.repeat(30), serviceCity: 'BKK' }, therapistUser.token);
    const db = await getDb();
    await db.update(therapists).set({ verificationStatus: 'passed' }).where(eq(therapists.userId, therapistUser.id));
  }, 30_000);

  it('GET /me 返回客户信息（无 therapist 段）', async () => {
    const res = await api.get<{
      user: { user_type: string };
      roles: string[];
      points: { balance: number };
      therapist: unknown;
    }>('/me', customerUser.token);
    expect(res.status).toBe(200);
    expect(res.body.data?.user.user_type).toBe('customer');
    expect(res.body.data?.therapist).toBeNull();
    expect(res.body.data?.points.balance).toBe(0);
    expect(res.body.data?.roles).toEqual([]);
  });

  it('GET /me 返回技师信息（含 therapist 段）', async () => {
    const res = await api.get<{
      user: { user_type: string };
      therapist: { verification_status: string; profile_completeness: number };
    }>('/me', therapistUser.token);
    expect(res.body.data?.user.user_type).toBe('therapist');
    expect(res.body.data?.therapist?.verification_status).toBe('passed');
  });

  it('GET /me/orders 客户口径', async () => {
    const res = await api.get<unknown[]>('/me/orders', customerUser.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('未登录访问 /me 401', async () => {
    const res = await api.get('/me');
    expect(res.status).toBe(401);
  });
});

describe('E2E · Stripe 降级 stub (D-101)', () => {
  it('无 STRIPE_SECRET_KEY 时 channel=stripe 自动降级 stub', async () => {
    await truncateAll();
    const c = await registerNew('customer');

    // 显式指定 stripe channel
    const res = await api.post<{ kind: string; pointsCredited?: number; clientSecret?: string }>(
      '/payments/recharge',
      { amount_usd_cents: 500, channel: 'stripe' },
      c.access_token,
    );
    expect(res.status).toBe(200);
    // CI 不配 Stripe key，预期降级到 stub
    expect(res.body.data?.kind).toBe('stub');
    expect(res.body.data?.pointsCredited).toBe(500);

    // 验证积分入账
    const me = await api.get<{ points: { balance: number } }>('/me', c.access_token);
    expect(me.body.data?.points.balance).toBe(500);
  });

  it('stripe webhook 端点存在（无 signature 应 400）', async () => {
    const res = await api.post('/webhooks/stripe', {});
    expect(res.status).toBe(400);
  });
});

describe('E2E · R2 stub URL (D-102)', () => {
  it('无 R2 凭证时 upload-init 返回 stub URL', async () => {
    await truncateAll();
    const t = await registerNew('therapist');

    const res = await api.post<{ uploadUrl: string; r2Key: string; mediaId: string }>(
      '/therapists/me/media/upload-init',
      {
        purpose: 'avatar',
        mime_type: 'image/jpeg',
        size_bytes: 102400,
        ext: 'jpg',
      },
      t.access_token,
    );
    expect(res.status).toBe(200);
    // CI 不配 R2 key，预期 stub URL
    expect(res.body.data?.uploadUrl).toMatch(/stub=1$/);
    expect(res.body.data?.r2Key).toMatch(/^avatar\/\d{6}\/[\w-]+\/[\w-]+\.jpg$/);
  });
});

describe('E2E · 角色管理边界', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    await truncateAll();
    const a = await registerNew('customer');
    admin = { token: a.access_token, id: a.user.id };
    const db = await getDb();
    await db.insert(userRoles).values({ userId: admin.id, role: 'admin' });
  });

  it('GET /me/roles 返回自己的所有有效角色', async () => {
    const res = await api.get<string[]>('/me/roles', admin.token);
    expect(res.body.data).toContain('admin');
  });

  it('admin 撤销自己的 admin 角色后失去访问权（自杀场景）', async () => {
    await api.delete('/admin/roles', { user_id: admin.id, role: 'admin' }, admin.token);
    const after = await api.get('/admin/dashboard', admin.token);
    expect(after.status).toBe(403);
  });
});
