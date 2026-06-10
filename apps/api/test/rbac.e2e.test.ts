/**
 * E2E · RBAC P0+P1 · 角色目录 + 权限 catalog + resolveUserPermissions + CRUD
 *
 * 跑：
 *   export JWT_SECRET=$(grep '^JWT_SECRET=' .env | cut -d= -f2-)
 *   export DATABASE_URL="postgresql://loverush:$PASS@localhost:54399/loverush_test"
 *   cd apps/api && ./node_modules/.bin/vitest run test/rbac.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { eq, and, isNull } from 'drizzle-orm';
import { userRoles, roles, rolePermissions } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';
import { PERMISSIONS, ALL_PERMISSION_KEYS } from '../src/services/permissionCatalog';
import { resolveUserPermissions } from '../src/services/permissions';

// ─── 全局 setup ────────────────────────────────────────────────────────────

let adminToken: string;
let adminId: string;

let csToken: string;
let csUserId: string;

let noRoleToken: string;
let noRoleUserId: string;

beforeAll(async () => {
  await truncateAll();
  const db = await getDb();

  // admin 用户
  const a = await registerNew('customer');
  adminToken = a.access_token;
  adminId = a.user.id;
  await db.insert(userRoles).values({ userId: adminId, role: 'admin' });

  // cs 用户
  const cs = await registerNew('customer');
  csToken = cs.access_token;
  csUserId = cs.user.id;
  await db.insert(userRoles).values({ userId: csUserId, role: 'cs' });

  // 无角色用户
  const nr = await registerNew('customer');
  noRoleToken = nr.access_token;
  noRoleUserId = nr.user.id;

  // 插入系统角色种子（测试库无 seed，手动补）
  await db.insert(roles).values([
    { key: 'admin',   nameZh: '超级管理员', isSystem: true },
    { key: 'auditor', nameZh: '审核员',     isSystem: true },
    { key: 'finance', nameZh: '财务',       isSystem: true },
    { key: 'cs',      nameZh: '客服',       isSystem: true },
    { key: 'ops',     nameZh: '运营',       isSystem: true },
  ]).onConflictDoNothing();

  // cs 角色权限种子
  await db.insert(rolePermissions).values([
    { roleKey: 'cs', permissionKey: 'orders' },
    { roleKey: 'cs', permissionKey: 'tickets' },
    { roleKey: 'cs', permissionKey: 'users.customers' },
  ]).onConflictDoNothing();
});

// ─── 1. catalog 非空且覆盖菜单项 ──────────────────────────────────────────

describe('1. 权限 catalog', () => {
  it('GET /admin/permissions/catalog 返回 ~50 项', async () => {
    const r = await api.get<typeof PERMISSIONS>('/admin/permissions/catalog', adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data!.length).toBeGreaterThanOrEqual(40);
  });

  it('catalog 每项都有 key/label/group/navHref/apiPrefixes', () => {
    for (const p of PERMISSIONS) {
      expect(typeof p.key).toBe('string');
      expect(p.key.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe('string');
      expect(typeof p.group).toBe('string');
      expect(typeof p.navHref).toBe('string');
      expect(Array.isArray(p.apiPrefixes)).toBe(true);
    }
  });

  it('ALL_PERMISSION_KEYS 与 catalog 条目一一对应', () => {
    expect(ALL_PERMISSION_KEYS.length).toBe(PERMISSIONS.length);
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(PERMISSIONS.length); // 无重复
  });

  it('未登录访问 catalog → 401', async () => {
    const r = await api.get('/admin/permissions/catalog');
    expect(r.status).toBe(401);
  });
});

// ─── 2. my-permissions ────────────────────────────────────────────────────

describe('2. GET /admin/my-permissions', () => {
  it('admin 用户 → 返回全部权限', async () => {
    const r = await api.get<string[]>('/admin/my-permissions', adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data!.length).toBe(ALL_PERMISSION_KEYS.length);
    expect(r.body.data).toContain('orders');
    expect(r.body.data).toContain('dashboard');
  });

  it('cs 用户 → 只含 cs 的权限子集', async () => {
    const r = await api.get<string[]>('/admin/my-permissions', csToken);
    expect(r.status).toBe(200);
    expect(r.body.data).toContain('orders');
    expect(r.body.data).toContain('tickets');
    expect(r.body.data).toContain('users.customers');
    // 不含 finance 权限
    expect(r.body.data).not.toContain('withdrawals');
  });

  it('无角色用户 → 空数组', async () => {
    const r = await api.get<string[]>('/admin/my-permissions', noRoleToken);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});

// ─── 3. resolveUserPermissions 单元行为 ──────────────────────────────────

describe('3. resolveUserPermissions 服务层', () => {
  it('admin 角色 → 返回所有权限', async () => {
    const db = await getDb();
    const perms = await resolveUserPermissions({ db }, adminId);
    expect(perms.size).toBe(ALL_PERMISSION_KEYS.length);
    for (const k of ALL_PERMISSION_KEYS) {
      expect(perms.has(k)).toBe(true);
    }
  });

  it('cs 角色 → 返回 role_permissions 中种子的权限', async () => {
    const db = await getDb();
    const perms = await resolveUserPermissions({ db }, csUserId);
    expect(perms.has('orders')).toBe(true);
    expect(perms.has('tickets')).toBe(true);
    expect(perms.has('withdrawals')).toBe(false);
  });

  it('无角色 → 空 Set', async () => {
    const db = await getDb();
    const perms = await resolveUserPermissions({ db }, noRoleUserId);
    expect(perms.size).toBe(0);
  });
});

// ─── 4. 自定义角色 CRUD + 权限配置 ────────────────────────────────────────

describe('4. 自定义角色 CRUD', () => {
  const CUSTOM_KEY = `test_custom_${Date.now()}`;

  it('POST /admin/roles/catalog 建自定义角色', async () => {
    const r = await api.post(
      '/admin/roles/catalog',
      { key: CUSTOM_KEY, name_zh: '测试自定义角色', description: '仅测试用' },
      adminToken,
    );
    expect(r.status).toBe(201);

    const created = r.body.data as { key: string; isSystem?: boolean; is_system?: boolean };
    expect(created.key).toBe(CUSTOM_KEY);
    expect(created.isSystem ?? created.is_system).toBe(false);
  });

  it('重复 key 返回 409', async () => {
    const r = await api.post(
      '/admin/roles/catalog',
      { key: CUSTOM_KEY, name_zh: '重复角色' },
      adminToken,
    );
    expect(r.status).toBe(409);
  });

  it('PUT /admin/roles/catalog/:key/permissions 配置权限', async () => {
    const r = await api.put(
      `/admin/roles/catalog/${CUSTOM_KEY}/permissions`,
      { permission_keys: ['orders', 'dashboard'] },
      adminToken,
    );
    expect(r.status).toBe(200);
    expect((r.body.data as { count: number }).count).toBe(2);
  });

  it('GET /admin/roles/catalog/:key/permissions 返回刚配的权限', async () => {
    const r = await api.get<string[]>(
      `/admin/roles/catalog/${CUSTOM_KEY}/permissions`,
      adminToken,
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toContain('orders');
    expect(r.body.data).toContain('dashboard');
    expect(r.body.data).not.toContain('withdrawals');
  });

  it('resolveUserPermissions 对持有自定义角色用户正确返回权限', async () => {
    const db = await getDb();
    // 创建一个新用户并赋予自定义角色
    const u = await registerNew('customer');
    await db.insert(userRoles).values({ userId: u.user.id, role: CUSTOM_KEY });

    const perms = await resolveUserPermissions({ db }, u.user.id);
    expect(perms.has('orders')).toBe(true);
    expect(perms.has('dashboard')).toBe(true);
    expect(perms.has('withdrawals')).toBe(false);
    // 不是全部权限
    expect(perms.size).toBe(2);
  });

  it('PUT /admin/roles/catalog/admin/permissions → 400（admin 不可改）', async () => {
    const r = await api.put(
      '/admin/roles/catalog/admin/permissions',
      { permission_keys: ['orders'] },
      adminToken,
    );
    expect(r.status).toBe(400);
  });

  it('PATCH /admin/roles/catalog/:key 改中文名', async () => {
    const r = await api.put(
      `/admin/roles/catalog/${CUSTOM_KEY}/permissions`,
      { permission_keys: ['orders'] },
      adminToken,
    );
    expect(r.status).toBe(200);

    const patch = await api.put(
      `/admin/roles/catalog/${CUSTOM_KEY}/permissions`,
      { permission_keys: ['orders', 'tickets'] },
      adminToken,
    );
    expect(patch.status).toBe(200);
    expect((patch.body.data as { count: number }).count).toBe(2);
  });

  it('GET /admin/roles/catalog 包含自定义角色', async () => {
    const r = await api.get<{ key: string }[]>('/admin/roles/catalog', adminToken);
    expect(r.status).toBe(200);
    const keys = (r.body.data as { key: string }[]).map((x) => x.key);
    expect(keys).toContain(CUSTOM_KEY);
    expect(keys).toContain('admin');
    expect(keys).toContain('cs');
  });

  it('DELETE /admin/roles/catalog/:key 删自定义角色（清掉持有人后）', async () => {
    // 先撤销所有持有人
    const db = await getDb();
    await db
      .update(userRoles)
      .set({ revokedAt: new Date() })
      .where(and(eq(userRoles.role, CUSTOM_KEY), isNull(userRoles.revokedAt)));

    const r = await api.delete(`/admin/roles/catalog/${CUSTOM_KEY}`, undefined, adminToken);
    expect(r.status).toBe(200);

    // 确认已删
    const r2 = await api.get<string[]>(`/admin/roles/catalog/${CUSTOM_KEY}/permissions`, adminToken);
    expect(r2.status).toBe(404);
  });

  it('DELETE 系统角色 → 400', async () => {
    const r = await api.delete('/admin/roles/catalog/cs', undefined, adminToken);
    expect(r.status).toBe(400);
  });
});

// ─── 5. 权限校验：非 admin 无法调 CRUD ───────────────────────────────────

describe('5. 权限边界', () => {
  it('cs 用户调 POST /admin/roles/catalog → 403', async () => {
    const r = await api.post(
      '/admin/roles/catalog',
      { key: 'unauthorized_role', name_zh: '无权' },
      csToken,
    );
    expect(r.status).toBe(403);
  });

  it('无 token 调 GET /admin/roles/catalog → 401', async () => {
    const r = await api.get('/admin/roles/catalog');
    expect(r.status).toBe(401);
  });
});
