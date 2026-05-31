/**
 * 当前用户路由 · D-201 / D-202
 *
 * GET    /me                      当前用户基本信息(user + 角色 + 积分 + 技师信息)
 * PATCH  /me                      改 display_name / avatar_url / locale(客户+技师共用)
 * PATCH  /me/locale               旧路径 · 仅改 locale · 兼容保留
 * GET    /me/orders               我的订单
 * GET    /me/favorites            我收藏的技师
 * POST   /me/media/upload-init    申请头像上传 URL(客户限 purpose='avatar')
 * POST   /me/media/finalize       上传完成回调
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
  notifications,
  userLocationPreference,
  cities,
  areas,
} from '@loverush/db';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { getDb } from '../db';
import { loadEnv } from '../env';
import { listRoles, type RoleContext } from '../services/roles';
import { issueUploadUrl, finalizeMedia, type MediaContext } from '../services/media';

function mctx(): MediaContext {
  const env = loadEnv();
  return {
    db: getDb(),
    r2PublicBase: env.NODE_ENV === 'production' ? 'https://media.loverush.com' : undefined,
  };
}

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

// ──────────────── GET /me/bootstrap · 一发命中聚合(性能修复) ────────────────
//
// 用户在亚洲,Railway compute 在 SFO,每个 API 调用都要跨太平洋 ~300ms RTT。
// 原本进入 home 页需要串行 4 个 API(/me + /notifications + /location-preference
// + /therapists?limit=20)= 4×300ms = 1.2s 纯过路费。
//
// /me/bootstrap 在服务端(DB 同 region,毫秒级)并发查全 6 项,一次性返。
// 跨洲 4 次 → 1 次,首屏感知 -900ms。
//
// 前端 auth.tsx 拿到 bootstrap 后用 swr.mutate(key, data, false) 把各子段灌进
// SWR cache,之后 home/conversations/me 各页 useSWR 启动时直接命中 cache 0ms 显数据。

meRoutes.get('/bootstrap', async (c) => {
  const userId = c.get('userId');
  const db = getDb();

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'user not found');

  // 6 个查询全并发 · DB 在 SFO 内网毫秒级
  const [
    account,
    roles,
    therapist,
    unreadRows,
    locationRow,
  ] = await Promise.all([
    db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) }),
    listRoles({ db }, userId).catch(() => [] as Awaited<ReturnType<typeof listRoles>>),
    user.userType === 'therapist'
      ? db.query.therapists.findFirst({ where: eq(therapists.userId, userId) })
      : Promise.resolve(null),
    // 未读通知数(BottomNav 红点)· 用 idx_notif_unread 索引
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(sql`${notifications.recipientUserId} = ${userId} AND ${notifications.readAt} IS NULL`),
    // 位置偏好(home / discover 用)
    db.query.userLocationPreference.findFirst({
      where: eq(userLocationPreference.userId, userId),
    }),
  ]);

  // location 字段需要再查 city + area name(避免多 join 这里串行 2 次,但 DB 同 region)
  let locationPref: {
    cityId: string | null;
    cityCode: string | null;
    cityName: string | null;
    areaId: string | null;
    areaCode: string | null;
    areaName: string | null;
    source: string;
    updatedAt: Date;
  } | null = null;
  if (locationRow) {
    const [city, area] = await Promise.all([
      locationRow.cityId
        ? db.query.cities.findFirst({ where: eq(cities.id, locationRow.cityId) })
        : Promise.resolve(null),
      locationRow.areaId
        ? db.query.areas.findFirst({ where: eq(areas.id, locationRow.areaId) })
        : Promise.resolve(null),
    ]);
    const locale = user.locale ?? 'zh';
    const pickName = (t: unknown, fallback: string | null): string | null => {
      const tr = (t ?? {}) as Record<string, string>;
      return tr[locale] ?? tr['zh'] ?? fallback;
    };
    locationPref = {
      cityId: locationRow.cityId,
      cityCode: city?.code ?? null,
      cityName: city ? pickName(city.translations, city.code) : null,
      areaId: locationRow.areaId,
      areaCode: area?.code ?? null,
      areaName: area ? pickName(area.translations, area.code) : null,
      source: locationRow.source,
      updatedAt: locationRow.updatedAt,
    };
  }

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
      // 新增聚合字段
      unread_count: unreadRows[0]?.n ?? 0,
      location_pref: locationPref,
    },
  });
});

// ──────────────── PATCH /me · 改昵称 / 头像 / 语言 ────────────────

/**
 * 业务规则:
 * - display_name: 1-40 字符 trim 后非空 · 允许 Unicode(中文/emoji)
 * - avatar_url: 必须 https URL,或空串='' 代表清空头像
 * - locale: 6 语言枚举
 * - 三项均可选,只传一项也合法
 * - 改昵称视为"激活信号" · 触发 markActivatedAsync(防被 inactive 治理误删)
 */
const PatchMeBody = z.object({
  display_name: z.string().trim().min(1).max(40).optional(),
  avatar_url: z
    .union([z.string().url().max(500), z.literal('')])
    .optional(),
  locale: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']).optional(),
});

meRoutes.patch('/', zValidator('json', PatchMeBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const db = getDb();

  const patch: Partial<typeof users.$inferInsert> = {};
  if (body.display_name !== undefined) patch.displayName = body.display_name;
  if (body.avatar_url !== undefined) patch.avatarUrl = body.avatar_url === '' ? null : body.avatar_url;
  if (body.locale !== undefined) patch.locale = body.locale;

  if (Object.keys(patch).length === 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'no fields to patch');
  }

  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      locale: users.locale,
    });

  if (!updated) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  // 改昵称/头像视为激活信号(0009 inactive 治理对齐)· 异步不阻塞
  if (body.display_name !== undefined || body.avatar_url !== undefined) {
    const { markActivatedAsync } = await import('../services/activation');
    markActivatedAsync(db, userId);
  }

  return c.json({
    data: {
      id: updated.id,
      display_name: updated.displayName,
      avatar_url: updated.avatarUrl,
      locale: updated.locale,
    },
  });
});

// ──────────────── /me/media · 客户也可上传头像 ────────────────

/**
 * 客户和技师共用 · 但 purpose 校验差异化:
 *   - 客户只允许 avatar / chat_attachment
 *   - 技师全 purpose 允许(继续走 /therapists/me/media/* 旧路径,这里也支持)
 */
const MeMediaInitBody = z.object({
  purpose: z.enum(['avatar', 'voice_intro', 'short_video', 'gallery', 'liveness', 'chat_attachment']),
  mime_type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  size_bytes: z.number().int().positive(),
  ext: z.string().regex(/^[a-z0-9]{1,8}$/i),
});

const MeMediaFinalizeBody = z.object({
  media_id: z.string().uuid(),
  actual_size_bytes: z.number().int().positive().optional(),
  duration_ms: z.number().int().positive().optional(),
  width_px: z.number().int().positive().optional(),
  height_px: z.number().int().positive().optional(),
  thumbnail_url: z.string().url().optional(),
  visibility: z.enum(['public', 'paid_unlock', 'platform_only']).optional(),
  unlock_price_points: z.number().int().nonnegative().optional(),
});

const CUSTOMER_ALLOWED_PURPOSES = new Set(['avatar', 'chat_attachment']);

meRoutes.post('/media/upload-init', zValidator('json', MeMediaInitBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  // 客户限 purpose
  const user = await getDb().query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'user not found');
  if (user.userType === 'customer' && !CUSTOMER_ALLOWED_PURPOSES.has(body.purpose)) {
    throw HttpError.forbidden(
      ErrorCode.E0001_INVALID_PARAM,
      `customer can only upload avatar/chat_attachment, got ${body.purpose}`,
    );
  }

  const result = await issueUploadUrl(mctx(), {
    ownerUserId: userId,
    purpose: body.purpose,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
    ext: body.ext,
  });
  return c.json({ data: result });
});

meRoutes.post('/media/finalize', zValidator('json', MeMediaFinalizeBody), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const result = await finalizeMedia(mctx(), {
    mediaId: body.media_id,
    ownerUserId: userId,
    actualSizeBytes: body.actual_size_bytes,
    durationMs: body.duration_ms,
    widthPx: body.width_px,
    heightPx: body.height_px,
    thumbnailUrl: body.thumbnail_url,
    visibility: body.visibility,
    unlockPricePoints: body.unlock_price_points,
  });
  return c.json({ data: result });
});

/** PATCH /me/locale · 旧路径 · 仅改 locale · 兼容保留 */
const LocaleBody = z.object({
  locale: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']),
});
/** GET /me/favorites · M02 Phase 6 · 我收藏的技师 */
meRoutes.get('/favorites', async (c) => {
  const userId = c.get('userId');
  const { favorites, therapists: tt, users: uu } = await import('@loverush/db');
  const { eq: eqFn, desc: descFn } = await import('drizzle-orm');
  // JOIN therapists + users 一次拿完整 view
  const rows = await getDb()
    .select({
      id: tt.id,
      userId: tt.userId,
      displayName: uu.displayName,
      avatarUrl: tt.avatarUrl,
      bio: tt.bio,
      nationality: tt.nationality,
      languages: tt.languages,
      serviceCity: tt.serviceCity,
      onlineStatus: tt.onlineStatus,
      scoreService: tt.scoreService,
      ratingCount: tt.ratingCount,
      favoritedAt: favorites.createdAt,
    })
    .from(favorites)
    .innerJoin(tt, eqFn(tt.id, favorites.therapistId))
    .innerJoin(uu, eqFn(uu.id, tt.userId))
    .where(eqFn(favorites.customerId, userId))
    .orderBy(descFn(favorites.createdAt));
  return c.json({ data: rows });
});

meRoutes.patch('/locale', zValidator('json', LocaleBody), async (c) => {
  const userId = c.get('userId');
  const { locale } = c.req.valid('json');
  await getDb().update(users).set({ locale }).where(eq(users.id, userId));
  return c.json({ data: { locale } });
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
