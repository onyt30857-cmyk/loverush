/**
 * 用户管理 · admin 端
 *
 * GET    /admin/users                 列出用户（按 user_type / status / 注册时间）
 * GET    /admin/users/:id             用户详情（含角色 / 积分 / 技师档案）
 * POST   /admin/users/:id/suspend     暂停账号
 * POST   /admin/users/:id/ban         封禁
 * POST   /admin/users/:id/restore     解封
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, ilike } from 'drizzle-orm';
import { pointsAccount, therapists, userRoles, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { recordAudit } from '../services/audit';

const ListQuery = z.object({
  user_type: z.enum(['customer', 'therapist']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'banned']).optional(),
  search: z.string().max(100).optional(), // 按 displayName 模糊
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const SuspendBody = z.object({ reason: z.string().min(1).max(500) });

export const adminUserRoutes = new Hono();
adminUserRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

adminUserRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const db = getDb();

  const conds = [];
  if (q.user_type) conds.push(eq(users.userType, q.user_type));
  if (q.status) conds.push(eq(users.status, q.status));
  if (q.search) conds.push(ilike(users.displayName, `%${q.search}%`));

  const list = await db.query.users.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(users.createdAt)],
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  });

  // 不返回敏感字段
  const cleaned = list.map((u) => ({
    id: u.id,
    user_type: u.userType,
    status: u.status,
    display_name: u.displayName,
    avatar_url: u.avatarUrl,
    locale: u.locale,
    gender: u.gender,
    created_at: u.createdAt,
    last_active_at: u.lastActiveAt,
    banned_at: u.bannedAt,
  }));

  return c.json({ data: cleaned });
});

adminUserRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  const [acc, roles, therapist] = await Promise.all([
    db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, id) }),
    db.query.userRoles.findMany({ where: eq(userRoles.userId, id) }),
    u.userType === 'therapist'
      ? db.query.therapists.findFirst({ where: eq(therapists.userId, id) })
      : Promise.resolve(null),
  ]);

  return c.json({
    data: {
      user: {
        id: u.id,
        user_type: u.userType,
        status: u.status,
        display_name: u.displayName,
        avatar_url: u.avatarUrl,
        locale: u.locale,
        gender: u.gender,
        created_at: u.createdAt,
        last_active_at: u.lastActiveAt,
        banned_at: u.bannedAt,
      },
      points: acc
        ? { balance: Number(acc.balance), frozen: Number(acc.frozen), total_in: Number(acc.totalIn), total_out: Number(acc.totalOut) }
        : null,
      roles: roles.map((r) => ({ role: r.role, granted_at: r.grantedAt, revoked_at: r.revokedAt })),
      therapist: therapist
        ? {
            id: therapist.id,
            verification_status: therapist.verificationStatus,
            profile_completeness: therapist.profileCompleteness,
            score_service: therapist.scoreService,
            completed_orders: therapist.completedOrders,
            cooling_status: therapist.coolingStatus,
            online_status: therapist.onlineStatus,
          }
        : null,
    },
  });
});

adminUserRoutes.post('/:id/suspend', zValidator('json', SuspendBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb();
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  await db.update(users).set({ status: 'suspended', updatedAt: new Date() }).where(eq(users.id, id));
  await recordAudit({ db }, c, {
    action: 'user.suspend',
    targetType: 'user',
    targetId: id,
    before: { status: target?.status },
    after: { status: 'suspended' },
    reason: body.reason,
  });
  return c.json({ data: { ok: true, reason: body.reason } });
});

adminUserRoutes.post('/:id/ban', zValidator('json', SuspendBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb();
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  await db
    .update(users)
    .set({ status: 'banned', bannedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, id));
  await recordAudit({ db }, c, {
    action: 'user.ban',
    targetType: 'user',
    targetId: id,
    before: { status: target?.status, bannedAt: target?.bannedAt },
    after: { status: 'banned' },
    reason: body.reason,
  });
  return c.json({ data: { ok: true, reason: body.reason } });
});

adminUserRoutes.post('/:id/restore', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  await db
    .update(users)
    .set({ status: 'active', bannedAt: null, updatedAt: new Date() })
    .where(eq(users.id, id));
  await recordAudit({ db }, c, {
    action: 'user.restore',
    targetType: 'user',
    targetId: id,
    before: { status: target?.status, bannedAt: target?.bannedAt },
    after: { status: 'active', bannedAt: null },
  });
  return c.json({ data: { ok: true } });
});
