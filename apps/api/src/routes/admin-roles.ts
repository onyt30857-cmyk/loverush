/**
 * 角色管理路由 · 仅 admin
 *
 * GET    /admin/roles/me                 我的角色（任何登录用户都能查）
 * POST   /admin/roles                    赋予角色（仅 admin）
 * DELETE /admin/roles                    撤销角色（仅 admin）
 * GET    /admin/roles?role=...           列出该角色的所有 user
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { grant, listRoles, listUsersByRole, revoke, type RoleContext } from '../services/roles';
import { recordAudit } from '../services/audit';

function ctx(): RoleContext {
  return { db: getDb() };
}

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

// 自己看自己的角色 — 任何登录用户
export const meRolesRoutes = new Hono();
meRolesRoutes.use('*', requireAuth);
meRolesRoutes.get('/', async (c) => {
  const roles = await listRoles(ctx(), c.get('userId') as string);
  return c.json({ data: roles });
});

// 角色管理 — 仅 admin
export const adminRoleRoutes = new Hono();
adminRoleRoutes.use('*', requireAuth, requireRole(['admin']));

adminRoleRoutes.post('/', zValidator('json', GrantBody), async (c) => {
  const body = c.req.valid('json');
  const row = await grant(ctx(), {
    userId: body.user_id,
    role: body.role,
    grantedByUserId: c.get('userId') as string,
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
