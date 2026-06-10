/**
 * E2E · RBAC 自定义角色收口 · requireRole 权限感知
 *
 * 验证命门修复：自定义角色持有路径对应权限 key 时，
 * requireRole 内层闸不再以"角色名不在列表"为由返回 403。
 *
 * 覆盖：
 *   1. 自定义角色真生效 — 只配了 orders 权限的角色访问 /admin/orders → 200/数据，不是 403
 *   2. 边界不放松 — 同一自定义角色访问 /admin/withdrawals（未配权限）→ 403
 *   3. 系统角色回归 — cs 访问 /admin/orders 仍过；finance 访问 /admin/users 仍 403
 *   4. admin 恒全 — admin 任意端点放行
 *   5. 未映射路径 — 自定义角色无论权限如何，未映射路径仍按角色名严格校验
 *
 * 跑：
 *   PASS=$(grep '^DATABASE_URL=' ".env" | sed -E 's#.*loverush:([^@]*)@localhost.*#\1#')
 *   export JWT_SECRET=$(grep '^JWT_SECRET=' ".env" | cut -d= -f2-)
 *   export DATABASE_URL="postgresql://loverush:$PASS@localhost:54399/loverush_test"
 *   cd apps/api && ./node_modules/.bin/vitest run test/rbac-custom-role.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { userRoles, roles, rolePermissions } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';

// ─── Setup ────────────────────────────────────────────────────────────────────

let adminToken: string;
let csToken: string;
let financeToken: string;
/** 只配了 orders 权限的自定义角色用户 */
let customOrdersToken: string;
/** 配了 orders + withdrawals 两个权限的自定义角色用户 */
let customMultiToken: string;

beforeAll(async () => {
  await truncateAll();
  const db = await getDb();

  // ── 角色种子 ──
  await db.insert(roles).values([
    { key: 'admin',                nameZh: '超级管理员',       isSystem: true  },
    { key: 'cs',                   nameZh: '客服',             isSystem: true  },
    { key: 'finance',              nameZh: '财务',             isSystem: true  },
    { key: 'custom-orders-only',   nameZh: '仅订单自定义角色', isSystem: false },
    { key: 'custom-orders-fin',    nameZh: '订单+资金自定义',  isSystem: false },
  ]).onConflictDoNothing();

  // ── 权限种子 ──
  await db.insert(rolePermissions).values([
    // cs
    { roleKey: 'cs', permissionKey: 'orders' },
    { roleKey: 'cs', permissionKey: 'tickets' },
    // finance
    { roleKey: 'finance', permissionKey: 'withdrawals' },
    { roleKey: 'finance', permissionKey: 'finance' },
    // 自定义：仅 orders
    { roleKey: 'custom-orders-only', permissionKey: 'orders' },
    // 自定义：orders + withdrawals
    { roleKey: 'custom-orders-fin', permissionKey: 'orders' },
    { roleKey: 'custom-orders-fin', permissionKey: 'withdrawals' },
  ]).onConflictDoNothing();

  // ── 用户注册 + 角色赋予 ──
  const adminResult = await registerNew('customer');
  adminToken = adminResult.access_token;
  await db.insert(userRoles).values({ userId: adminResult.user.id, role: 'admin' });

  const csResult = await registerNew('customer');
  csToken = csResult.access_token;
  await db.insert(userRoles).values({ userId: csResult.user.id, role: 'cs' });

  const financeResult = await registerNew('customer');
  financeToken = financeResult.access_token;
  await db.insert(userRoles).values({ userId: financeResult.user.id, role: 'finance' });

  const customOrdersResult = await registerNew('customer');
  customOrdersToken = customOrdersResult.access_token;
  await db.insert(userRoles).values({ userId: customOrdersResult.user.id, role: 'custom-orders-only' });

  const customMultiResult = await registerNew('customer');
  customMultiToken = customMultiResult.access_token;
  await db.insert(userRoles).values({ userId: customMultiResult.user.id, role: 'custom-orders-fin' });
});

// ─── 1. 自定义角色真生效（核心断言） ─────────────────────────────────────────

describe('1. 自定义角色真生效 — requireRole 权限感知收口', () => {
  it('custom-orders-only 访问 /admin/orders → handler 真正处理（200，不是 requireRole 403）', async () => {
    const r = await api.get('/admin/orders', customOrdersToken);
    // 核心断言：不再被 requireRole 内层闸以角色名不匹配为由返回 403
    // handler 处理后返回 200 + 数据（订单列表，空数组也算成功响应）
    expect(r.status).toBe(200);
    // 额外验证：响应体是数据格式（data 字段存在，非 error）
    expect(r.body.error).toBeUndefined();
    expect(r.body.data).toBeDefined();
  });

  it('custom-orders-only 访问 /admin/orders → 返回数据（非 permission denied 错误消息）', async () => {
    const r = await api.get('/admin/orders', customOrdersToken);
    const errMsg: string = r.body.error?.message ?? '';
    // 绝对不应出现 requireRole 的拒绝消息
    expect(errMsg).not.toMatch(/requires one of roles/);
    // 也不应出现网关的权限拒绝消息（权限 key 匹配，网关已放行）
    expect(errMsg).not.toMatch(/permission denied: requires orders/);
  });

  it('custom-orders-fin（orders+withdrawals）访问 /admin/orders → 200', async () => {
    const r = await api.get('/admin/orders', customMultiToken);
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
  });

  it('custom-orders-fin（orders+withdrawals）访问 /admin/withdrawals → 非 requireRole 403', async () => {
    const r = await api.get('/admin/withdrawals', customMultiToken);
    // 有 withdrawals 权限 → requireRole 放行，handler 处理（200 或其他业务状态，但不是权限 403）
    expect(r.status).not.toBe(403);
    const errMsg: string = r.body.error?.message ?? '';
    expect(errMsg).not.toMatch(/requires one of roles/);
  });
});

// ─── 2. 边界不放松 ───────────────────────────────────────────────────────────

describe('2. 边界不放松 — 未配权限的端点仍 403', () => {
  it('custom-orders-only 访问 /admin/withdrawals（无 withdrawals 权限）→ 403', async () => {
    const r = await api.get('/admin/withdrawals', customOrdersToken);
    expect(r.status).toBe(403);
  });

  it('custom-orders-only 访问 /admin/currencies（无 currencies 权限）→ 403', async () => {
    const r = await api.get('/admin/currencies', customOrdersToken);
    expect(r.status).toBe(403);
  });

  it('custom-orders-only 访问 /admin/users（无 users 权限）→ 403', async () => {
    const r = await api.get('/admin/users', customOrdersToken);
    expect(r.status).toBe(403);
  });

  it('custom-orders-only 访问 /admin/flags（无 flags 权限）→ 403', async () => {
    const r = await api.get('/admin/flags', customOrdersToken);
    expect(r.status).toBe(403);
  });
});

// ─── 3. 系统角色回归 ──────────────────────────────────────────────────────────

describe('3. 系统角色回归 — 原有行为不变', () => {
  it('cs 访问 /admin/orders（有 cs 角色名匹配）→ 仍放行（200）', async () => {
    const r = await api.get('/admin/orders', csToken);
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
  });

  it('finance 访问 /admin/users（无角色名匹配 + 无路径权限）→ 仍 403', async () => {
    const r = await api.get('/admin/users', financeToken);
    expect(r.status).toBe(403);
  });

  it('cs 访问 /admin/withdrawals（无 cs 角色名 + 无路径权限）→ 仍 403', async () => {
    const r = await api.get('/admin/withdrawals', csToken);
    expect(r.status).toBe(403);
  });

  it('finance 访问 /admin/withdrawals（finance 角色名匹配）→ 仍放行（非 403）', async () => {
    const r = await api.get('/admin/withdrawals', financeToken);
    expect(r.status).not.toBe(403);
  });
});

// ─── 4. admin 恒全 ───────────────────────────────────────────────────────────

describe('4. admin 恒全 — 任意端点放行', () => {
  it('admin 访问 /admin/orders → 200', async () => {
    const r = await api.get('/admin/orders', adminToken);
    expect(r.status).toBe(200);
  });

  it('admin 访问 /admin/withdrawals → 非 403', async () => {
    const r = await api.get('/admin/withdrawals', adminToken);
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/currencies → 非 403', async () => {
    const r = await api.get('/admin/currencies', adminToken);
    expect(r.status).not.toBe(403);
  });

  it('admin 访问 /admin/flags → 非 403', async () => {
    const r = await api.get('/admin/flags', adminToken);
    expect(r.status).not.toBe(403);
  });
});

// ─── 5. 未映射路径 — 自定义角色仍按角色名严格校验（不因权限分支错误放松） ───

describe('5. 未映射路径 — 不因权限分支错误放行', () => {
  it('custom-orders-only 访问未映射路径 → 网关放行后底层 404（不是 200）', async () => {
    // 注：网关对未映射路径放行，requireRole 对未映射路径找不到权限 key 不走权限分支
    // custom-orders-only 不叫 admin/cs，角色名不匹配 → requireRole 仍 403
    // 但网关先放行 → 最终到 requireRole → 403（不是 404）
    // 路由有 requireRole 的情况下，自定义角色不持有角色名也不会因未映射而被意外放行
    const r = await api.get('/admin/nonexistent-truly-unmapped-xyz', customOrdersToken);
    // 网关放行（未映射），但路由不存在 → Hono 404
    // 或者：该路径下有 requireRole 但路由不存在 → 404（无路由）
    // 无论哪种结果，关键是自定义角色访问未映射路径不会得到 200
    expect(r.status).not.toBe(200);
  });
});
