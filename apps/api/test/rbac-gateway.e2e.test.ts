/**
 * E2E · RBAC P3 中心化权限网关回归测试
 *
 * 覆盖：
 *   1. admin 恒放行（任意 admin/* 端点不被网关 403）
 *   2. 系统角色边界：
 *      - finance → /admin/withdrawals 放行；/admin/users 403
 *      - ops     → /admin/dashboard 放行；/admin/withdrawals 403
 *      - cs      → /admin/orders 放行；/admin/currencies 403
 *   3. 自定义角色：只配 orders 权限 → /admin/orders 放行；/admin/withdrawals 403
 *   4. 未映射路径放行（/admin/xxx-unmapped-path → 非 403）
 *   5. /admin/my-permissions 白名单（任何已登录用户可访问）
 *   6. 无角色用户访问有映射路径 → 403
 *
 * 跑：
 *   PASS=$(grep '^DATABASE_URL=' ".env" | sed -E 's#.*loverush:([^@]*)@localhost.*#\1#')
 *   export JWT_SECRET=$(grep '^JWT_SECRET=' ".env" | cut -d= -f2-)
 *   export DATABASE_URL="postgresql://loverush:$PASS@localhost:54399/loverush_test"
 *   ./node_modules/.bin/vitest run test/rbac-gateway.e2e.test.ts test/rbac.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { userRoles, roles, rolePermissions } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';

// ─── 全局 setup ────────────────────────────────────────────────────────────

let adminToken: string;
let financeToken: string;
let opsToken: string;
let csToken: string;
let customToken: string;   // 只配 orders 权限的自定义角色
let noRoleToken: string;

beforeAll(async () => {
  await truncateAll();
  const db = await getDb();

  // 插入系统角色种子（测试库无 seed，手动补）
  await db.insert(roles).values([
    { key: 'admin',   nameZh: '超级管理员', isSystem: true },
    { key: 'auditor', nameZh: '审核员',     isSystem: true },
    { key: 'finance', nameZh: '财务',       isSystem: true },
    { key: 'cs',      nameZh: '客服',       isSystem: true },
    { key: 'ops',     nameZh: '运营',       isSystem: true },
    { key: 'custom-orders-only', nameZh: '仅订单角色', isSystem: false },
  ]).onConflictDoNothing();

  // 系统角色权限种子（finance/ops/cs）
  await db.insert(rolePermissions).values([
    // finance
    { roleKey: 'finance', permissionKey: 'withdrawals' },
    { roleKey: 'finance', permissionKey: 'finance' },
    { roleKey: 'finance', permissionKey: 'platform-accounts' },
    { roleKey: 'finance', permissionKey: 'currencies' },
    { roleKey: 'finance', permissionKey: 'exchange-rates' },
    { roleKey: 'finance', permissionKey: 'redeem' },
    { roleKey: 'finance', permissionKey: 'agents' },
    // ops
    { roleKey: 'ops', permissionKey: 'dashboard' },
    { roleKey: 'ops', permissionKey: 'matching-health' },
    { roleKey: 'ops', permissionKey: 'shows' },
    { roleKey: 'ops', permissionKey: 'flags' },
    { roleKey: 'ops', permissionKey: 'broadcasts' },
    { roleKey: 'ops', permissionKey: 'geo.dashboard' },
    { roleKey: 'ops', permissionKey: 'geo.supply-demand' },
    { roleKey: 'ops', permissionKey: 'geo.countries' },
    { roleKey: 'ops', permissionKey: 'geo.cities' },
    { roleKey: 'ops', permissionKey: 'geo.areas' },
    { roleKey: 'ops', permissionKey: 'search.analytics' },
    { roleKey: 'ops', permissionKey: 'ai.system' },
    { roleKey: 'ops', permissionKey: 'ai.messages' },
    // cs
    { roleKey: 'cs', permissionKey: 'orders' },
    { roleKey: 'cs', permissionKey: 'tickets' },
    { roleKey: 'cs', permissionKey: 'users.customers' },
    { roleKey: 'cs', permissionKey: 'users.therapists' },
    { roleKey: 'cs', permissionKey: 'disputes' },
    { roleKey: 'cs', permissionKey: 'reviews' },
    { roleKey: 'cs', permissionKey: 'prompts' },
    // 自定义角色
    { roleKey: 'custom-orders-only', permissionKey: 'orders' },
  ]).onConflictDoNothing();

  // 注册各角色用户
  const adminResult = await registerNew('customer');
  adminToken = adminResult.access_token;
  await db.insert(userRoles).values({ userId: adminResult.user.id, role: 'admin' });

  const financeResult = await registerNew('customer');
  financeToken = financeResult.access_token;
  await db.insert(userRoles).values({ userId: financeResult.user.id, role: 'finance' });

  const opsResult = await registerNew('customer');
  opsToken = opsResult.access_token;
  await db.insert(userRoles).values({ userId: opsResult.user.id, role: 'ops' });

  const csResult = await registerNew('customer');
  csToken = csResult.access_token;
  await db.insert(userRoles).values({ userId: csResult.user.id, role: 'cs' });

  const customResult = await registerNew('customer');
  customToken = customResult.access_token;
  await db.insert(userRoles).values({ userId: customResult.user.id, role: 'custom-orders-only' });

  const noRoleResult = await registerNew('customer');
  noRoleToken = noRoleResult.access_token;
});

// ─── 1. admin 恒放行 ───────────────────────────────────────────────────────

describe('1. admin 恒放行', () => {
  it('admin 访问 /admin/withdrawals → 不被网关 403（底层 requireRole 可能返回其他状态）', async () => {
    const r = await api.get('/admin/withdrawals', adminToken);
    // 网关不拦截 admin，底层返回 200 或业务错误，但绝不是 403 permission denied
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/dashboard → 不被网关 403', async () => {
    const r = await api.get('/admin/dashboard', adminToken);
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/orders → 不被网关 403', async () => {
    const r = await api.get('/admin/orders', adminToken);
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/currencies → 不被网关 403', async () => {
    const r = await api.get('/admin/currencies', adminToken);
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/users → 不被网关 403', async () => {
    const r = await api.get('/admin/users', adminToken);
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/flags → 不被网关 403', async () => {
    const r = await api.get('/admin/flags', adminToken);
    expect(r.status).not.toBe(403);
  });
});

// ─── 2. finance 角色边界 ───────────────────────────────────────────────────

describe('2. finance 角色边界', () => {
  it('finance 访问 /admin/withdrawals（有权）→ 网关放行（非 403）', async () => {
    const r = await api.get('/admin/withdrawals', financeToken);
    expect(r.status).not.toBe(403);
  });

  it('finance 访问 /admin/users（无权）→ 403', async () => {
    const r = await api.get('/admin/users', financeToken);
    expect(r.status).toBe(403);
  });

  it('finance 访问 /admin/orders（无权）→ 403', async () => {
    const r = await api.get('/admin/orders', financeToken);
    expect(r.status).toBe(403);
  });

  it('finance 访问 /admin/currencies（有权）→ 网关放行（非 403）', async () => {
    const r = await api.get('/admin/currencies', financeToken);
    expect(r.status).not.toBe(403);
  });
});

// ─── 3. ops 角色边界 ───────────────────────────────────────────────────────

describe('3. ops 角色边界', () => {
  it('ops 访问 /admin/dashboard（有权）→ 网关放行（非 403）', async () => {
    const r = await api.get('/admin/dashboard', opsToken);
    expect(r.status).not.toBe(403);
  });

  it('ops 访问 /admin/withdrawals（无权）→ 403', async () => {
    const r = await api.get('/admin/withdrawals', opsToken);
    expect(r.status).toBe(403);
  });

  it('ops 访问 /admin/flags（有权）→ 网关放行（非 403）', async () => {
    const r = await api.get('/admin/flags', opsToken);
    expect(r.status).not.toBe(403);
  });

  it('ops 访问 /admin/orders（无权）→ 403', async () => {
    const r = await api.get('/admin/orders', opsToken);
    expect(r.status).toBe(403);
  });
});

// ─── 4. cs 角色边界 ────────────────────────────────────────────────────────

describe('4. cs 角色边界', () => {
  it('cs 访问 /admin/orders（有权）→ 网关放行（非 403）', async () => {
    const r = await api.get('/admin/orders', csToken);
    expect(r.status).not.toBe(403);
  });

  it('cs 访问 /admin/currencies（无权）→ 403', async () => {
    const r = await api.get('/admin/currencies', csToken);
    expect(r.status).toBe(403);
  });

  it('cs 访问 /admin/withdrawals（无权）→ 403', async () => {
    const r = await api.get('/admin/withdrawals', csToken);
    expect(r.status).toBe(403);
  });

  it('cs 访问 /admin/tickets（有权）→ 网关放行（非 403）', async () => {
    const r = await api.get('/admin/tickets', csToken);
    expect(r.status).not.toBe(403);
  });
});

// ─── 5. 自定义角色（只有 orders 权限） ──────────────────────────────────────
//
// 说明：P3 网关是按权限 key 放行的叠加层，底层 requireRole 按 role name 继续保留。
// 自定义角色 "custom-orders-only" 在网关层有 orders 权限会放行，
// 但底层 requireRole(['admin','cs']) 只认固定 role name，会进一步拦截。
// 这是"双层防线"正常行为——网关 403 vs 底层 requireRole 403 都是 403，
// 但网关拦截时 body.error.message 包含 "permission denied: requires"。

describe('5. 自定义角色边界', () => {
  it('只配 orders 权限的角色 → /admin/orders：网关放行（orders权限匹配），底层 requireRole 可能继续校验', async () => {
    const r = await api.get('/admin/orders', customToken);
    // 网关层：有 orders 权限 → 网关放行，不返回网关 permission denied 消息
    // 底层 requireRole(['admin','cs']) 还是按 role name 拦截（这是双层防线预期行为）
    // 验证：若 403，错误消息不是网关的 "permission denied: requires orders"
    if (r.status === 403) {
      const msg: string = r.body.error?.message ?? '';
      expect(msg).not.toMatch(/permission denied: requires orders/);
    }
    // 关键断言：网关没有以 "requires orders" 拒绝（说明网关层正确放行了）
    expect(r.body.error?.message ?? '').not.toMatch(/permission denied: requires orders/);
  });

  it('只配 orders 权限的角色 → /admin/withdrawals：网关 403（无 withdrawals 权限）', async () => {
    const r = await api.get('/admin/withdrawals', customToken);
    expect(r.status).toBe(403);
    // 确认是网关层拦截
    expect(r.body.error?.message).toMatch(/permission denied: requires withdrawals/);
  });

  it('只配 orders 权限的角色 → /admin/users：网关 403（无 users.customers/users.therapists 权限）', async () => {
    const r = await api.get('/admin/users', customToken);
    expect(r.status).toBe(403);
    expect(r.body.error?.message).toMatch(/permission denied: requires users\./);
  });

  it('只配 orders 权限的角色 → /admin/dashboard：网关 403（无 dashboard 权限）', async () => {
    const r = await api.get('/admin/dashboard', customToken);
    expect(r.status).toBe(403);
    expect(r.body.error?.message).toMatch(/permission denied: requires dashboard/);
  });
});

// ─── 6. 未映射路径放行 ─────────────────────────────────────────────────────

describe('6. 未映射路径放行（绝不默认拦截）', () => {
  // 注意：/admin/purchases 在 catalog 里是有映射的（apiPrefixes: ['/admin/purchases']），
  // 归属 'purchases' 权限，cs 没有该权限，所以 403 是正确的网关拦截行为（非放行）。
  // 真正"未映射"的是 catalog 里完全没有任何 apiPrefix 前缀覆盖的路径。

  it('完全未映射路径（catalog 无覆盖）→ 网关放行，返回 404 非 403', async () => {
    // /admin/nonexistent-unmapped-endpoint-xyz 在 catalog 里没有任何匹配
    const r = await api.get('/admin/nonexistent-unmapped-endpoint-xyz', csToken);
    // 网关：未映射 → 放行（warn），底层找不到路由 → 404
    expect(r.status).toBe(404);
    // 错误消息不是网关的 permission denied
    const msg = r.body.error?.message ?? '';
    expect(msg).not.toMatch(/permission denied/);
  });

  it('完全未映射路径对 noRole 用户也放行（网关层不拦）', async () => {
    const r = await api.get('/admin/totally-unknown-path-abc123', noRoleToken);
    // 网关：未映射 → 放行，底层 404（无路由）
    expect(r.status).toBe(404);
    const msg = r.body.error?.message ?? '';
    expect(msg).not.toMatch(/permission denied/);
  });

  // /admin/purchases 已在 catalog 映射为 purchases 权限，cs 无该权限 → 403 是正确行为
  it('/admin/purchases 已映射为 purchases 权限，cs 无权 → 403（网关正确拦截）', async () => {
    const r = await api.get('/admin/purchases', csToken);
    expect(r.status).toBe(403);
    expect(r.body.error?.message).toMatch(/permission denied: requires purchases/);
  });
});

// ─── 7. 白名单端点（任何已登录用户可访问） ────────────────────────────────

describe('7. 白名单：/admin/my-permissions 任何登录用户可访问', () => {
  it('无角色用户访问 /admin/my-permissions → 200（权限初始化端点）', async () => {
    const r = await api.get('/admin/my-permissions', noRoleToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data).toHaveLength(0); // 无角色 → 空权限列表
  });

  it('finance 用户访问 /admin/my-permissions → 200', async () => {
    const r = await api.get('/admin/my-permissions', financeToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect((r.body.data as string[]).length).toBeGreaterThan(0);
  });

  it('admin 访问 /admin/permissions/catalog → 200', async () => {
    const r = await api.get('/admin/permissions/catalog', adminToken);
    expect(r.status).toBe(200);
  });
});

// ─── 8. 无角色用户访问有映射路径 → 403 ────────────────────────────────────

describe('8. 无角色用户访问有映射路径', () => {
  it('无角色访问 /admin/orders → 403', async () => {
    const r = await api.get('/admin/orders', noRoleToken);
    expect(r.status).toBe(403);
  });

  it('无角色访问 /admin/dashboard → 403', async () => {
    const r = await api.get('/admin/dashboard', noRoleToken);
    expect(r.status).toBe(403);
  });

  it('未登录访问 /admin/orders → 401（requireAuth 先拦截）', async () => {
    const r = await api.get('/admin/orders');
    expect(r.status).toBe(401);
  });
});
