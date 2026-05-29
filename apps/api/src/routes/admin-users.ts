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
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  orders,
  pointsAccount,
  pointsTransaction,
  reviews,
  riskEvents,
  therapistEarnings,
  therapists,
  tickets,
  userRoles,
  users,
  withdrawals,
} from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { recordAudit } from '../services/audit';
import { credit, debit } from '../services/points';

const ListQuery = z.object({
  user_type: z.enum(['customer', 'therapist']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'banned']).optional(),
  search: z.string().max(100).optional(), // 按 displayName 模糊
  // 无效账户治理:默认只显已激活,后台主表更干净
  activated: z.enum(['only', 'inactive', 'all']).optional(),
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
  // 默认 'only'(已激活),'inactive'=未激活,'all'=不过滤
  const activatedMode = q.activated ?? 'only';
  if (activatedMode === 'only') conds.push(sql`${users.activatedAt} IS NOT NULL`);
  else if (activatedMode === 'inactive') conds.push(sql`${users.activatedAt} IS NULL`);

  // LEFT JOIN points_account 一次取积分(避免列表里 N+1 查询)
  const rows = await db
    .select({
      id: users.id,
      user_type: users.userType,
      status: users.status,
      display_name: users.displayName,
      avatar_url: users.avatarUrl,
      locale: users.locale,
      gender: users.gender,
      created_at: users.createdAt,
      last_active_at: users.lastActiveAt,
      banned_at: users.bannedAt,
      activated_at: users.activatedAt,
      points_balance: pointsAccount.balance,
    })
    .from(users)
    .leftJoin(pointsAccount, eq(pointsAccount.userId, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(q.limit ?? 50)
    .offset(q.offset ?? 0);

  // 同步返回两类总数(给前端 toggle 显示徽标)
  const baseConds = [];
  if (q.user_type) baseConds.push(eq(users.userType, q.user_type));
  if (q.status) baseConds.push(eq(users.status, q.status));
  if (q.search) baseConds.push(ilike(users.displayName, `%${q.search}%`));

  const counts = await db
    .select({
      activated: sql<number>`count(*) FILTER (WHERE ${users.activatedAt} IS NOT NULL)::int`,
      inactive: sql<number>`count(*) FILTER (WHERE ${users.activatedAt} IS NULL)::int`,
    })
    .from(users)
    .where(baseConds.length ? and(...baseConds) : undefined);

  return c.json({
    data: {
      list: rows.map((r) => ({
        ...r,
        points_balance: r.points_balance ?? 0,
      })),
      counts: counts[0] ?? { activated: 0, inactive: 0 },
      activated_mode: activatedMode,
    },
  });
});

adminUserRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  const isTherapist = u.userType === 'therapist';

  // ── 基础聚合(并行) ──────────────────────────────
  const [acc, roles, therapist] = await Promise.all([
    db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, id) }),
    db.query.userRoles.findMany({ where: eq(userRoles.userId, id) }),
    isTherapist
      ? db.query.therapists.findFirst({ where: eq(therapists.userId, id) })
      : Promise.resolve(null),
  ]);

  // ── 订单(客户:作为 customer · 技师:作为 therapist_user)──
  const orderRows = await db
    .select({
      id: orders.id,
      order_no: orders.orderNo,
      status: orders.status,
      price_points: orders.pricePoints,
      created_at: orders.createdAt,
      paid_at: orders.paidAt,
      customer_id: orders.customerId,
      therapist_user_id: orders.therapistUserId,
    })
    .from(orders)
    .where(isTherapist ? eq(orders.therapistUserId, id) : eq(orders.customerId, id))
    .orderBy(desc(orders.createdAt))
    .limit(20);

  // ── 积分流水(双方都有) ──
  const txnRows = await db
    .select({
      id: pointsTransaction.id,
      type: pointsTransaction.type,
      direction: pointsTransaction.direction,
      amount: pointsTransaction.amount,
      balance_after: pointsTransaction.balanceAfter,
      related_order_id: pointsTransaction.relatedOrderId,
      description: pointsTransaction.description,
      created_at: pointsTransaction.createdAt,
    })
    .from(pointsTransaction)
    .where(eq(pointsTransaction.userId, id))
    .orderBy(desc(pointsTransaction.createdAt))
    .limit(30);

  // ── 工单(作为 reporter 或 target) ──
  const ticketRows = await db
    .select({
      id: tickets.id,
      ticket_no: tickets.ticketNo,
      status: tickets.status,
      category: tickets.category,
      reporter_user_id: tickets.reporterUserId,
      target_user_id: tickets.targetUserId,
      opened_at: tickets.openedAt,
      closed_at: tickets.closedAt,
    })
    .from(tickets)
    .where(or(eq(tickets.reporterUserId, id), eq(tickets.targetUserId, id)))
    .orderBy(desc(tickets.openedAt))
    .limit(20);

  // ── 评价(客户:他写的 · 技师:他收到的) ──
  const reviewRows = await db
    .select({
      id: reviews.id,
      order_id: reviews.orderId,
      score_service: reviews.scoreService,
      score_appearance: reviews.scoreAppearance,
      score_body: reviews.scoreBody,
      content: reviews.content,
      is_hidden: reviews.isHidden,
      appeal_status: reviews.appealStatus,
      created_at: reviews.createdAt,
    })
    .from(reviews)
    .where(isTherapist ? eq(reviews.targetUserId, id) : eq(reviews.reviewerUserId, id))
    .orderBy(desc(reviews.createdAt))
    .limit(20);

  // ── 技师专属:收益 + 提现 + 风控事件 ──
  let earningsRow: typeof therapistEarnings.$inferSelect | null = null;
  let withdrawalRows: Array<{
    id: string;
    amount_cents: number;
    status: string;
    method: string;
    requested_at: Date;
    paid_at: Date | null;
  }> = [];
  let riskRows: Array<{
    id: string;
    event_type: string;
    severity: number;
    resolution: string | null;
    created_at: Date;
  }> = [];

  if (isTherapist) {
    const [e, w, r] = await Promise.all([
      db.query.therapistEarnings.findFirst({ where: eq(therapistEarnings.therapistUserId, id) }),
      db
        .select({
          id: withdrawals.id,
          amount_cents: withdrawals.amountCents,
          status: withdrawals.status,
          method: withdrawals.method,
          requested_at: withdrawals.requestedAt,
          paid_at: withdrawals.paidAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.therapistUserId, id))
        .orderBy(desc(withdrawals.requestedAt))
        .limit(20),
      db
        .select({
          id: riskEvents.id,
          event_type: riskEvents.eventType,
          severity: riskEvents.severity,
          resolution: riskEvents.resolution,
          created_at: riskEvents.createdAt,
        })
        .from(riskEvents)
        .where(eq(riskEvents.subjectUserId, id))
        .orderBy(desc(riskEvents.createdAt))
        .limit(20),
    ]);
    earningsRow = e ?? null;
    withdrawalRows = w;
    riskRows = r;
  }

  // ── 订单聚合(运营快速判断) ──
  const orderField = isTherapist ? orders.therapistUserId : orders.customerId;
  const [orderAgg] = (await db.execute(sql`
    SELECT
      COUNT(*)::int                                                                          AS total,
      COUNT(*) FILTER (WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED'))::int    AS paid,
      COUNT(*) FILTER (WHERE status IN ('COMPLETED','REVIEWED'))::int                        AS completed,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int                                      AS cancelled,
      COUNT(*) FILTER (WHERE status = 'DISPUTED')::int                                       AS disputed,
      COUNT(*) FILTER (WHERE status = 'REFUNDED')::int                                       AS refunded,
      COALESCE(SUM(price_points) FILTER (WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED')), 0)::bigint AS gross_points
    FROM orders
    WHERE ${orderField} = ${id}
  `)) as Array<{
    total: number;
    paid: number;
    completed: number;
    cancelled: number;
    disputed: number;
    refunded: number;
    gross_points: string;
  }>;

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
            service_city: therapist.serviceCity,
            service_area: therapist.serviceArea,
            nationality: therapist.nationality,
          }
        : null,
      order_summary: orderAgg
        ? {
            total: orderAgg.total,
            paid: orderAgg.paid,
            completed: orderAgg.completed,
            cancelled: orderAgg.cancelled,
            disputed: orderAgg.disputed,
            refunded: orderAgg.refunded,
            gross_points: parseInt(orderAgg.gross_points, 10),
          }
        : null,
      recent_orders: orderRows,
      recent_transactions: txnRows,
      tickets: ticketRows,
      reviews: reviewRows,
      earnings: earningsRow
        ? {
            available_cents: Number(earningsRow.availableCents),
            pending_cents: Number(earningsRow.pendingCents),
            withdrawn_cents: Number(earningsRow.withdrawnCents),
            tip_earnings_cents: Number(earningsRow.tipEarningsCents),
            shop_commission_cents: Number(earningsRow.shopCommissionCents),
            invite_rewards_cents: Number(earningsRow.inviteRewardsCents),
          }
        : null,
      withdrawals: withdrawalRows,
      risk_events: riskRows,
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

// ──────────────── 无效账户清理(admin) ────────────────
// POST /admin/users/cleanup-inactive
//   { older_than_hours: 24, dry_run: true } → 返回数量,不删
//   { older_than_hours: 24, dry_run: false } → 真删,写 audit
// 仅 activated_at IS NULL 且 created_at < NOW() - INTERVAL 'X hours' 的 user 才会被删。
// ON DELETE CASCADE 会自动清理:auth_sessions / points_account / 等所有外键引用。
const CleanupBody = z.object({
  older_than_hours: z.coerce.number().int().min(1).max(720).default(24),
  dry_run: z.boolean().default(true),
});

adminUserRoutes.post('/cleanup-inactive', zValidator('json', CleanupBody), async (c) => {
  const body = c.req.valid('json');
  const db = getDb();

  // 1. 先 SELECT 看会清掉多少 + 列出前 10 个用作 audit 证据
  const cutoffSql = sql`NOW() - INTERVAL '${sql.raw(String(body.older_than_hours))} hours'`;
  const candidates = await db
    .select({ id: users.id, user_type: users.userType, created_at: users.createdAt })
    .from(users)
    .where(and(sql`${users.activatedAt} IS NULL`, sql`${users.createdAt} < ${cutoffSql}`))
    .limit(10000);

  const count = candidates.length;

  if (body.dry_run) {
    return c.json({
      data: {
        dry_run: true,
        would_delete: count,
        sample: candidates.slice(0, 10),
      },
    });
  }

  // 2. 真删 · CASCADE 自动清外键引用
  if (count > 0) {
    const ids = candidates.map((u) => u.id);
    await db
      .delete(users)
      .where(and(sql`${users.activatedAt} IS NULL`, sql`${users.createdAt} < ${cutoffSql}`));

    await recordAudit({ db }, c, {
      action: 'user.cleanup_inactive',
      targetType: 'user',
      targetId: null,
      before: null,
      after: { deleted_count: count, older_than_hours: body.older_than_hours, sample_ids: ids.slice(0, 20) },
      reason: `批量清理 activated_at IS NULL 且 ${body.older_than_hours}h+ 老账户`,
    });
  }

  return c.json({ data: { dry_run: false, deleted: count } });
});

// ──────────────── 手动调整积分(admin/cs) ────────────────
// POST /admin/users/:id/points/adjust { amount: number, reason: string }
// amount > 0 → credit(加),amount < 0 → debit(扣)· 必填 reason 进 audit
// 用 credit/debit service 走 transaction + transaction 表 + idempotency · 自动写流水
const AdjustBody = z.object({
  amount: z.number().int().refine((v) => v !== 0, { message: 'amount cannot be 0' }),
  reason: z.string().min(1).max(500),
});

adminUserRoutes.post('/:id/points/adjust', zValidator('json', AdjustBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb();

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  const operatorId = c.get('userId' as never) as string | undefined;
  const idempotencyKey = `admin-adjust-${operatorId ?? 'unknown'}-${id}-${Date.now()}`;
  const abs = Math.abs(body.amount);

  let txn;
  if (body.amount > 0) {
    txn = await credit(
      { db },
      {
        userId: id,
        type: 'ADJUSTMENT',
        amount: abs,
        description: `admin 手动调整(+${abs}) · ${body.reason}`,
        idempotencyKey,
        metadata: { operator_id: operatorId, reason: body.reason },
      },
    );
  } else {
    txn = await debit(
      { db },
      {
        userId: id,
        type: 'ADJUSTMENT',
        amount: abs,
        description: `admin 手动调整(-${abs}) · ${body.reason}`,
        idempotencyKey,
        metadata: { operator_id: operatorId, reason: body.reason },
      },
    );
  }

  await recordAudit({ db }, c, {
    action: 'user.points_adjust',
    targetType: 'user',
    targetId: id,
    before: null,
    after: { delta: body.amount, balance_after: Number(txn.balanceAfter) },
    reason: body.reason,
  });

  return c.json({
    data: {
      ok: true,
      delta: body.amount,
      balance_after: Number(txn.balanceAfter),
      transaction_id: txn.id,
    },
  });
});
