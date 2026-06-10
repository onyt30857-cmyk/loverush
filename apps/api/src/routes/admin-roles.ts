/**
 * 角色管理路由
 *
 * 现有（保留）：
 *   GET    /me/roles                        我的角色（任何登录用户都能查，在 meRolesRoutes）
 *   POST   /admin/roles                     赋予用户角色（仅 admin）
 *   DELETE /admin/roles                     撤销用户角色（仅 admin）
 *   GET    /admin/roles/:role/users         列出该角色的所有 user（保留）
 *
 * 新增（P0+P1）：
 *   GET    /admin/permissions/catalog       权限目录（给矩阵 UI）
 *   GET    /admin/my-permissions            当前用户权限 key 数组（给导航）
 *   GET    /admin/roles                     角色目录列表（key/name_zh/is_system/权限数/持有人数）
 *   POST   /admin/roles/catalog             建自定义角色 {key,name_zh,description}
 *   PATCH  /admin/roles/catalog/:key        改 name_zh/description
 *   DELETE /admin/roles/catalog/:key        删（仅自定义且无人持有）
 *   GET    /admin/roles/catalog/:key/permissions    取某角色权限 key 数组
 *   PUT    /admin/roles/catalog/:key/permissions    覆盖设置权限（admin 角色不可改）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, isNull, inArray, count } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { grant, listRoles, listUsersByRole, revoke, type RoleContext } from '../services/roles';
import { resolveUserPermissions } from '../services/permissions';
import { PERMISSIONS, ALL_PERMISSION_KEYS } from '../services/permissionCatalog';
import { recordAudit } from '../services/audit';
import { roles, rolePermissions, userRoles } from '@loverush/db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

function ctx(): RoleContext { return { db: getDb() }; }

// ── 现有：用户 grant/revoke ────────────────────────────────────────────────

const RoleEnum = z.enum(['admin', 'auditor', 'finance', 'cs', 'ops']);

const GrantBody = z.object({
  user_id: z.string().uuid(),
  role: RoleEnum,
});

const RevokeBody = z.object({
  user_id: z.string().uuid(),
  role: RoleEnum,
  reason: z.string().max(200).optional(),
});

/** 自己看自己的角色 — 任何登录用户 */
export const meRolesRoutes = new Hono();
meRolesRoutes.use('*', requireAuth);
meRolesRoutes.get('/', async (c) => {
  const userRoleList = await listRoles(ctx(), c.get('userId'));
  return c.json({ data: userRoleList });
});

// ── 权限 catalog（无需 admin） ────────────────────────────────────────────

/** 挂在 /admin/permissions：GET /admin/permissions/catalog */
export const adminPermissionRoutes = new Hono();
adminPermissionRoutes.use('*', requireAuth);

adminPermissionRoutes.get('/catalog', (c) => {
  return c.json({ data: PERMISSIONS });
});

/** 挂在 /admin/my-permissions：GET /admin/my-permissions */
export const adminMyPermissionsRoute = new Hono();
adminMyPermissionsRoute.use('*', requireAuth);
adminMyPermissionsRoute.get('/', async (c) => {
  const db = getDb();
  const keys = await resolveUserPermissions({ db }, c.get('userId'));
  return c.json({ data: Array.from(keys) });
});

// ── 角色管理 ─────────────────────────────────────────────────────────────

export const adminRoleRoutes = new Hono();
adminRoleRoutes.use('*', requireAuth, requireRole(['admin']));

// ── 用户角色 grant/revoke（保留现有） ──────────────────────────────────────

adminRoleRoutes.post('/', zValidator('json', GrantBody), async (c) => {
  const body = c.req.valid('json');
  const row = await grant(ctx(), {
    userId: body.user_id,
    role: body.role,
    grantedByUserId: c.get('userId'),
  });
  await recordAudit(ctx(), c, {
    action: 'role.grant',
    targetType: 'user',
    targetId: body.user_id,
    after: { role: body.role },
  });
  return c.json({ data: row });
});

adminRoleRoutes.delete('/', zValidator('json', RevokeBody), async (c) => {
  const body = c.req.valid('json');
  await revoke(ctx(), { userId: body.user_id, role: body.role, reason: body.reason });
  await recordAudit(ctx(), c, {
    action: 'role.revoke',
    targetType: 'user',
    targetId: body.user_id,
    before: { role: body.role },
    reason: body.reason,
  });
  return c.json({ data: { ok: true } });
});

adminRoleRoutes.get('/:role/users', async (c) => {
  const role = c.req.param('role') as 'admin' | 'auditor' | 'finance' | 'cs' | 'ops';
  if (!['admin', 'auditor', 'finance', 'cs', 'ops'].includes(role)) {
    return c.json({ data: [] });
  }
  const list = await listUsersByRole(ctx(), role);
  return c.json({ data: list });
});

// ── 角色目录（新 RBAC CRUD） ──────────────────────────────────────────────

/**
 * GET /admin/roles/catalog
 * 列出所有角色（系统 + 自定义），含每角色权限数和持有人数。
 */
adminRoleRoutes.get('/catalog', async (c) => {
  const db = getDb();

  // 角色列表
  const roleRows = await db.select().from(roles);

  // 每角色权限数
  const permCounts = await db
    .select({
      roleKey: rolePermissions.roleKey,
      cnt: count(rolePermissions.permissionKey),
    })
    .from(rolePermissions)
    .groupBy(rolePermissions.roleKey);
  const permCountMap = new Map(permCounts.map((r) => [r.roleKey, Number(r.cnt)]));

  // 每角色持有人数（活跃）
  const holderCounts = await db
    .select({
      role: userRoles.role,
      cnt: count(userRoles.userId),
    })
    .from(userRoles)
    .where(isNull(userRoles.revokedAt))
    .groupBy(userRoles.role);
  const holderCountMap = new Map(holderCounts.map((r) => [r.role, Number(r.cnt)]));

  const data = roleRows.map((r) => ({
    key:          r.key,
    name_zh:      r.nameZh,
    description:  r.description,
    is_system:    r.isSystem,
    permission_count: r.key === 'admin' ? ALL_PERMISSION_KEYS.length : (permCountMap.get(r.key) ?? 0),
    holder_count: holderCountMap.get(r.key) ?? 0,
    created_at:   r.createdAt,
    updated_at:   r.updatedAt,
  }));

  return c.json({ data });
});

const NewRoleBody = z.object({
  key:         z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, '只允许小写字母、数字、下划线'),
  name_zh:     z.string().min(1).max(40),
  description: z.string().max(200).optional(),
});

/**
 * POST /admin/roles/catalog
 * 建自定义角色。key 不能与现有冲突，is_system=false。
 */
adminRoleRoutes.post('/catalog', zValidator('json', NewRoleBody), async (c) => {
  const body = c.req.valid('json');
  const db = getDb();

  // key 唯一校验
  const existing = await db.query.roles.findFirst({ where: eq(roles.key, body.key) });
  if (existing) {
    throw HttpError.conflict(ErrorCode.E0002_IDEMPOTENCY_CONFLICT, `角色 key "${body.key}" 已存在`);
  }

  const inserted = await db.insert(roles).values({
    key:         body.key,
    nameZh:      body.name_zh,
    description: body.description,
    isSystem:    false,
    createdBy:   c.get('userId'),
  }).returning();
  const row = inserted[0]!;

  await recordAudit(ctx(), c, {
    action: 'role.create',
    targetType: 'role',
    targetId: row.id,
    after: { key: body.key, name_zh: body.name_zh },
  });

  return c.json({ data: row }, 201);
});

const PatchRoleBody = z.object({
  name_zh:     z.string().min(1).max(40).optional(),
  description: z.string().max(200).optional(),
});

/**
 * PATCH /admin/roles/catalog/:key
 * 改中文名/描述。系统角色也可改名，但不可改 key。
 */
adminRoleRoutes.patch('/catalog/:key', zValidator('json', PatchRoleBody), async (c) => {
  const key = c.req.param('key');
  const body = c.req.valid('json');
  const db = getDb();

  const existing = await db.query.roles.findFirst({ where: eq(roles.key, key) });
  if (!existing) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, `角色 "${key}" 不存在`);
  }

  const updates: Partial<{ nameZh: string; description: string; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (body.name_zh !== undefined) updates.nameZh = body.name_zh;
  if (body.description !== undefined) updates.description = body.description;

  const updatedRows = await db.update(roles).set(updates).where(eq(roles.key, key)).returning();
  const updated = updatedRows[0]!;

  await recordAudit(ctx(), c, {
    action: 'role.update',
    targetType: 'role',
    targetId: existing.id,
    before: { name_zh: existing.nameZh, description: existing.description },
    after: { name_zh: updated.nameZh, description: updated.description },
  });

  return c.json({ data: updated });
});

/**
 * DELETE /admin/roles/catalog/:key
 * 仅可删自定义角色（is_system=false）且无人持有。
 */
adminRoleRoutes.delete('/catalog/:key', async (c) => {
  const key = c.req.param('key');
  const db = getDb();

  const existing = await db.query.roles.findFirst({ where: eq(roles.key, key) });
  if (!existing) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, `角色 "${key}" 不存在`);
  }
  if (existing.isSystem) {
    throw new HttpError(400, ErrorCode.E2020_USER_TYPE_LOCKED, '系统角色不可删除');
  }

  // 持有人校验
  const holders = await db.query.userRoles.findMany({
    where: and(eq(userRoles.role, key), isNull(userRoles.revokedAt)),
  });
  if (holders.length > 0) {
    throw new HttpError(400, ErrorCode.E2020_USER_TYPE_LOCKED, `该角色仍有 ${holders.length} 名持有人，请先撤销后再删除`);
  }

  // 删权限映射
  await db.delete(rolePermissions).where(eq(rolePermissions.roleKey, key));
  // 删角色
  await db.delete(roles).where(eq(roles.key, key));

  await recordAudit(ctx(), c, {
    action: 'role.delete',
    targetType: 'role',
    targetId: existing.id,
    before: { key, name_zh: existing.nameZh },
  });

  return c.json({ data: { ok: true } });
});

/**
 * GET /admin/roles/catalog/:key/permissions
 * 取某角色的权限 key 数组。admin 角色返回全部。
 */
adminRoleRoutes.get('/catalog/:key/permissions', async (c) => {
  const key = c.req.param('key');
  const db = getDb();

  const existing = await db.query.roles.findFirst({ where: eq(roles.key, key) });
  if (!existing) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, `角色 "${key}" 不存在`);
  }

  if (key === 'admin') {
    return c.json({ data: ALL_PERMISSION_KEYS });
  }

  const rows = await db
    .select({ permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleKey, key));

  return c.json({ data: rows.map((r) => r.permissionKey) });
});

const SetPermissionsBody = z.object({
  permission_keys: z.array(z.string().min(1)).max(200),
});

/**
 * PUT /admin/roles/catalog/:key/permissions
 * 覆盖设置角色权限列表。admin 角色恒全权，不允许改。
 */
adminRoleRoutes.put(
  '/catalog/:key/permissions',
  zValidator('json', SetPermissionsBody),
  async (c) => {
    const key = c.req.param('key');
    const body = c.req.valid('json');
    const db = getDb();

    if (key === 'admin') {
      throw new HttpError(400, ErrorCode.E2020_USER_TYPE_LOCKED, 'admin 角色恒全权，不可修改权限矩阵');
    }

    const existing = await db.query.roles.findFirst({ where: eq(roles.key, key) });
    if (!existing) {
      throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, `角色 "${key}" 不存在`);
    }

    // 校验 permission_keys 都在 catalog 中
    const validKeys = new Set(ALL_PERMISSION_KEYS);
    const invalid = body.permission_keys.filter((k) => !validKeys.has(k));
    if (invalid.length > 0) {
      throw new HttpError(400, ErrorCode.E0001_INVALID_PARAM, `以下 permission_key 不在 catalog 中：${invalid.join(', ')}`);
    }

    // 查现有权限（for audit before）
    const before = await db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleKey, key));
    const beforeKeys = before.map((r) => r.permissionKey);

    // 覆盖写：先删后插（幂等）
    await db.delete(rolePermissions).where(eq(rolePermissions.roleKey, key));

    if (body.permission_keys.length > 0) {
      await db.insert(rolePermissions).values(
        body.permission_keys.map((pk) => ({ roleKey: key, permissionKey: pk })),
      );
    }

    await recordAudit(ctx(), c, {
      action: 'role.permissions.set',
      targetType: 'role',
      targetId: existing.id,
      before: { permission_keys: beforeKeys },
      after: { permission_keys: body.permission_keys },
    });

    return c.json({ data: { ok: true, count: body.permission_keys.length } });
  },
);
