/**
 * 当前用户路由 · D-201 / D-202
 *
 * GET /me              当前用户基本信息（user + 角色 + 积分余额 + 技师信息）
 * GET /me/orders       我的订单（按当前 user 是 customer / therapist 自动判断）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, desc, or } from 'drizzle-orm';
import {
  orders,
  pointsAccount,
  therapists,
  users,
} from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { getDb } from '../db';
import { listRoles, type RoleContext } from '../services/roles';

const ListQuery = z.object({
  status: z
    .enum([
      'DRAFT',
      'PENDING_CONFIRM',
      'LOCKED',
      'PAID',
      'IN_SERVICE',
      'COMPLETED',
      'REVIEWED',
      'CANCELLED',
      'DISPUTED',
      'REFUNDED',
      'CLOSED',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const meRoutes = new Hono();
meRoutes.use('*', requireAuth);

meRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDb();

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'user not found');

  const [account, roles, therapist] = await Promise.all([
    db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) }),
    // 角色是可选附加信息：查询失败（如表缺失）也不能让整个 /me 500、进而把用户登出
    listRoles({ db }, userId).catch((e) => {
      console.warn('[me] listRoles failed, degrading to []:', e);
      return [] as Awaited<ReturnType<typeof listRoles>>;
    }),
    user.userType === 'therapist'
      ? db.query.therapists.findFirst({ where: eq(therapists.userId, userId) })
      : Promise.resolve(null),
  ]);

  return c.json({
    data: {
      user: {
        id: user.id,
        user_type: user.userType,
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        locale: user.locale,
        gender: user.gender,
        status: user.status,
        created_at: user.createdAt,
      },
      roles,
      points: account
        ? {
            balance: Number(account.balance),
            frozen: Number(account.frozen),
            total_in: Number(account.totalIn),
            total_out: Number(account.totalOut),
          }
        : { balance: 0, frozen: 0, total_in: 0, total_out: 0 },
      therapist: therapist
        ? {
            id: therapist.id,
            verification_status: therapist.verificationStatus,
            online_status: therapist.onlineStatus,
            profile_completeness: therapist.profileCompleteness,
            score_service: therapist.scoreService,
            completed_orders: therapist.completedOrders,
            cooling_status: therapist.coolingStatus,
          }
        : null,
    },
  });
});

meRoutes.get('/orders', zValidator('query', ListQuery), async (c) => {
  const userId = c.get('userId');
  const q = c.req.valid('query');
  const db = getDb();

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'user not found');

  // 双角色：customer / therapist 各自的口径
  const roleFilter = user.userType === 'therapist'
    ? eq(orders.therapistUserId, userId)
    : eq(orders.customerId, userId);

  const conds = [roleFilter];
  if (q.status) conds.push(eq(orders.status, q.status));

  const list = await db.query.orders.findMany({
    where: conds.length > 1 ? and(...conds) : conds[0],
    orderBy: [desc(orders.createdAt)],
    limit: q.limit ?? 30,
    offset: q.offset ?? 0,
  });

  return c.json({ data: list });
});

// 双向通用查询 · 给可能同时是 customer 也是 therapist 的特殊账号（admin 测试用）
meRoutes.get('/orders/any', zValidator('query', ListQuery), async (c) => {
  const userId = c.get('userId');
  const q = c.req.valid('query');
  const db = getDb();

  const list = await db.query.orders.findMany({
    where: or(eq(orders.customerId, userId), eq(orders.therapistUserId, userId)),
    orderBy: [desc(orders.createdAt)],
    limit: q.limit ?? 30,
    offset: q.offset ?? 0,
  });

  return c.json({ data: list });
});
