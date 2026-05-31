/**
 * M02b/M04 Phase 1 · 技师发布服务节目(shows) service
 *
 * v1 PRD M04 F04.2 核心载体
 * 状态机: draft → open → closed/completed
 *   - draft 任意编辑 · 仅技师可见
 *   - open 公开 + 可拍 · 仅 add_ons 可改(防作弊)
 *   - closed 技师主动下架 或 slots 售罄
 *   - completed 时段过去
 *
 * slots 防超卖: atomic UPDATE WHERE slots_remaining > 0 RETURNING
 */

import { and, eq, gt, gte, lte, desc, sql, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  shows,
  serviceCategories,
  users,
  therapists,
  type Show,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface ShowContext {
  db: Database;
}

export interface CreateShowArgs {
  categoryCode: string;
  startTime: Date;
  durationMin: number;
  pricePoints: number;
  slotsTotal?: number;
  addOns?: Array<{ name: string; pricePoints: number; isDefault?: boolean }>;
  includesNote?: string;
  excludesNote?: string;
  serviceCity?: string;
  serviceArea?: string;
}

export interface UpdateShowArgs {
  addOns?: Array<{ name: string; pricePoints: number; isDefault?: boolean }>;
  includesNote?: string;
  excludesNote?: string;
  // draft 态额外可改的字段
  categoryCode?: string;
  startTime?: Date;
  durationMin?: number;
  pricePoints?: number;
  slotsTotal?: number;
  serviceCity?: string;
  serviceArea?: string;
  // 状态切换
  status?: 'draft' | 'open' | 'closed';
}

const MAX_FUTURE_DAYS = 30;

/** 创建节目 · 默认 draft 态 */
export async function createShow(
  ctx: ShowContext,
  therapistUserId: string,
  args: CreateShowArgs,
): Promise<Show> {
  // 校验类型字典
  const cat = await ctx.db.query.serviceCategories.findFirst({
    where: and(eq(serviceCategories.code, args.categoryCode), eq(serviceCategories.isActive, 1)),
  });
  if (!cat) throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `service category not found: ${args.categoryCode}`);

  // 校验 start_time 未来 30 天内
  const now = Date.now();
  const futureLimit = now + MAX_FUTURE_DAYS * 24 * 3600 * 1000;
  if (args.startTime.getTime() < now) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'start_time must be in future');
  }
  if (args.startTime.getTime() > futureLimit) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `start_time must be within ${MAX_FUTURE_DAYS} days`);
  }

  // 校验技师 verification_status='passed'
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  if (t.verificationStatus !== 'passed') {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'verification required to publish shows');
  }

  const slotsTotal = args.slotsTotal ?? 1;
  if (slotsTotal < 1 || slotsTotal > 10) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'slots_total must be 1-10');
  }
  if (![60, 90, 120, 150, 180].includes(args.durationMin)) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'duration_min must be 60/90/120/150/180');
  }
  if (args.pricePoints < 1 || args.pricePoints > 99999) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'price_points must be 1-99999');
  }

  const [row] = await ctx.db
    .insert(shows)
    .values({
      therapistUserId,
      categoryCode: args.categoryCode,
      startTime: args.startTime,
      durationMin: args.durationMin,
      pricePoints: args.pricePoints,
      addOns: args.addOns ?? [],
      includesNote: args.includesNote,
      excludesNote: args.excludesNote,
      slotsTotal,
      slotsRemaining: slotsTotal,
      serviceCity: args.serviceCity,
      serviceArea: args.serviceArea,
      status: 'draft',
    })
    .returning();
  if (!row) throw HttpError.internal('show create failed');
  return row;
}

/** 列技师自己的节目(含所有状态) */
export async function listMyShows(
  ctx: ShowContext,
  therapistUserId: string,
  args: { status?: 'draft' | 'open' | 'closed' | 'completed' } = {},
): Promise<Show[]> {
  const conditions = [eq(shows.therapistUserId, therapistUserId)];
  if (args.status) conditions.push(eq(shows.status, args.status));
  return ctx.db.select().from(shows).where(and(...conditions)).orderBy(desc(shows.startTime));
}

/** 单条节目详情(self / public 都用) */
export async function getShow(ctx: ShowContext, showId: string): Promise<Show & {
  therapistDisplayName: string | null;
  therapistAvatarUrl: string | null;
  categoryNameZh: string | null;
  categoryIconEmoji: string | null;
}> {
  const rows = (await ctx.db.execute(sql`
    SELECT
      s.*,
      u.display_name AS therapist_display_name,
      COALESCE(t.avatar_url, u.avatar_url) AS therapist_avatar_url,
      c.name_zh AS category_name_zh,
      c.icon_emoji AS category_icon_emoji
    FROM shows s
    JOIN users u ON u.id = s.therapist_user_id
    LEFT JOIN therapists t ON t.user_id = s.therapist_user_id
    LEFT JOIN service_categories c ON c.code = s.category_code
    WHERE s.id = ${showId}::uuid
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'show not found');
  return rows[0] as Show & {
    therapistDisplayName: string | null;
    therapistAvatarUrl: string | null;
    categoryNameZh: string | null;
    categoryIconEmoji: string | null;
  };
}

/** 更新节目 · draft 任意改 · open 仅可改 add_ons/notes · closed/completed 不可改 */
export async function updateShow(
  ctx: ShowContext,
  therapistUserId: string,
  showId: string,
  args: UpdateShowArgs,
): Promise<Show> {
  const cur = await ctx.db.query.shows.findFirst({ where: eq(shows.id, showId) });
  if (!cur) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'show not found');
  if (cur.therapistUserId !== therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your show');
  }

  // 状态机校验
  if (cur.status === 'completed') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'completed show cannot be edited');
  }
  if (cur.status === 'closed' && args.status !== 'open') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'closed show can only be re-opened (or stay closed)');
  }
  if (cur.status === 'open') {
    // open 时仅 add_ons / notes / status 可改
    const forbidden: Array<keyof UpdateShowArgs> = ['categoryCode', 'startTime', 'durationMin', 'pricePoints', 'slotsTotal'];
    for (const k of forbidden) {
      if (args[k] !== undefined) {
        throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `cannot modify ${k} after publishing`);
      }
    }
  }

  // status 切换合法性
  if (args.status) {
    const allowed: Record<string, string[]> = {
      draft: ['open'],
      open: ['closed'],
      closed: ['open'], // 可再开放
    };
    if (!allowed[cur.status]?.includes(args.status)) {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `cannot transition ${cur.status} → ${args.status}`);
    }
  }

  // 校验类型(若改了)
  if (args.categoryCode && args.categoryCode !== cur.categoryCode) {
    const cat = await ctx.db.query.serviceCategories.findFirst({
      where: and(eq(serviceCategories.code, args.categoryCode), eq(serviceCategories.isActive, 1)),
    });
    if (!cat) throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `service category not found: ${args.categoryCode}`);
  }

  const patch: Partial<typeof shows.$inferInsert> = { updatedAt: new Date() };
  if (args.categoryCode !== undefined) patch.categoryCode = args.categoryCode;
  if (args.startTime !== undefined) patch.startTime = args.startTime;
  if (args.durationMin !== undefined) patch.durationMin = args.durationMin;
  if (args.pricePoints !== undefined) patch.pricePoints = args.pricePoints;
  if (args.slotsTotal !== undefined) {
    patch.slotsTotal = args.slotsTotal;
    patch.slotsRemaining = args.slotsTotal; // draft 重置 remaining
  }
  if (args.addOns !== undefined) patch.addOns = args.addOns;
  if (args.includesNote !== undefined) patch.includesNote = args.includesNote;
  if (args.excludesNote !== undefined) patch.excludesNote = args.excludesNote;
  if (args.serviceCity !== undefined) patch.serviceCity = args.serviceCity;
  if (args.serviceArea !== undefined) patch.serviceArea = args.serviceArea;
  if (args.status !== undefined) patch.status = args.status;

  const [row] = await ctx.db.update(shows).set(patch).where(eq(shows.id, showId)).returning();
  if (!row) throw HttpError.internal('show update failed');
  return row;
}

/** 删除节目 · 仅 draft 可删 */
export async function deleteShow(
  ctx: ShowContext,
  therapistUserId: string,
  showId: string,
): Promise<void> {
  const cur = await ctx.db.query.shows.findFirst({ where: eq(shows.id, showId) });
  if (!cur) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'show not found');
  if (cur.therapistUserId !== therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your show');
  }
  if (cur.status !== 'draft') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'only draft show can be deleted');
  }
  await ctx.db.delete(shows).where(eq(shows.id, showId));
}

/** 客户侧 · 拉公开节目列表 · 默认未来 7 天 · 仅 open + 未来时段 */
export async function listOpenShows(
  ctx: ShowContext,
  args: {
    categoryCode?: string;
    city?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {},
): Promise<Array<Show & {
  therapistDisplayName: string | null;
  therapistAvatarUrl: string | null;
  categoryNameZh: string | null;
  categoryIconEmoji: string | null;
}>> {
  const now = new Date();
  const from = args.from ?? now;
  const to = args.to ?? new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const limit = args.limit ?? 50;

  const rows = (await ctx.db.execute(sql`
    SELECT
      s.*,
      u.display_name AS therapist_display_name,
      COALESCE(t.avatar_url, u.avatar_url) AS therapist_avatar_url,
      c.name_zh AS category_name_zh,
      c.icon_emoji AS category_icon_emoji
    FROM shows s
    JOIN users u ON u.id = s.therapist_user_id
    LEFT JOIN therapists t ON t.user_id = s.therapist_user_id
    LEFT JOIN service_categories c ON c.code = s.category_code
    WHERE s.status = 'open'
      AND s.start_time >= ${from.toISOString()}::timestamptz
      AND s.start_time <= ${to.toISOString()}::timestamptz
      AND s.slots_remaining > 0
      ${args.categoryCode ? sql`AND s.category_code = ${args.categoryCode}` : sql``}
      ${args.city ? sql`AND s.service_city = ${args.city}` : sql``}
    ORDER BY s.start_time ASC
    LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows as Array<Show & {
    therapistDisplayName: string | null;
    therapistAvatarUrl: string | null;
    categoryNameZh: string | null;
    categoryIconEmoji: string | null;
  }>;
}

/** 原子扣 1 名额 · 失败抛 409(已售罄/不存在/已关) · 不引入 Redis */
export async function claimShowSlot(
  ctx: ShowContext,
  showId: string,
): Promise<{ showId: string; remaining: number; therapistUserId: string }> {
  const result = (await ctx.db.execute(sql`
    UPDATE shows
    SET slots_remaining = slots_remaining - 1,
        status = CASE WHEN slots_remaining - 1 <= 0 THEN 'closed' ELSE status END,
        updated_at = NOW()
    WHERE id = ${showId}::uuid
      AND status = 'open'
      AND slots_remaining > 0
      AND start_time > NOW()
    RETURNING id, slots_remaining, therapist_user_id
  `)) as unknown as Array<{ id: string; slots_remaining: number; therapist_user_id: string }>;

  if (result.length === 0) {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, 'show sold out or not available');
  }
  return {
    showId: result[0]!.id,
    remaining: result[0]!.slots_remaining,
    therapistUserId: result[0]!.therapist_user_id,
  };
}

/** Admin · 列所有节目(任意状态/时段) · 给 /admin/shows 监控页用 */
export async function listAllShowsAdmin(
  ctx: ShowContext,
  args: {
    status?: 'draft' | 'open' | 'closed' | 'completed';
    therapistUserId?: string;
    limit?: number;
  } = {},
): Promise<Array<Show & {
  therapistDisplayName: string | null;
  therapistAvatarUrl: string | null;
  categoryNameZh: string | null;
}>> {
  const limit = args.limit ?? 100;
  const rows = (await ctx.db.execute(sql`
    SELECT
      s.*,
      u.display_name AS therapist_display_name,
      COALESCE(t.avatar_url, u.avatar_url) AS therapist_avatar_url,
      c.name_zh AS category_name_zh
    FROM shows s
    JOIN users u ON u.id = s.therapist_user_id
    LEFT JOIN therapists t ON t.user_id = s.therapist_user_id
    LEFT JOIN service_categories c ON c.code = s.category_code
    WHERE 1=1
      ${args.status ? sql`AND s.status = ${args.status}` : sql``}
      ${args.therapistUserId ? sql`AND s.therapist_user_id = ${args.therapistUserId}::uuid` : sql``}
    ORDER BY s.start_time DESC
    LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows as Array<Show & {
    therapistDisplayName: string | null;
    therapistAvatarUrl: string | null;
    categoryNameZh: string | null;
  }>;
}

/** Admin · 强制关闭节目(违规节目 · admin 跳过技师) */
export async function forceCloseShowAdmin(
  ctx: ShowContext,
  showId: string,
  reason: string,
): Promise<Show> {
  const [row] = await ctx.db
    .update(shows)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(eq(shows.id, showId))
    .returning();
  if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'show not found');
  // audit log 在 route 里调
  void reason;
  return row;
}

/** 退回 1 名额(订单取消时) · 仅当 show 还未 completed */
export async function releaseShowSlot(ctx: ShowContext, showId: string): Promise<void> {
  await ctx.db.execute(sql`
    UPDATE shows
    SET slots_remaining = LEAST(slots_remaining + 1, slots_total),
        status = CASE WHEN status = 'closed' AND slots_remaining + 1 > 0 THEN 'open' ELSE status END,
        updated_at = NOW()
    WHERE id = ${showId}::uuid
      AND status != 'completed'
  `);
}
