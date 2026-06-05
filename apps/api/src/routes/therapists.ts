/**
 * 技师路由 · M02
 *
 * GET    /therapists/me                          自己的完整 profile
 * GET    /therapists/:id                         按调用方差异化字段
 * PUT    /therapists/me                          增量更新 profile
 * POST   /therapists/me/media/upload-init        申请上传 URL
 * POST   /therapists/me/media/finalize           上传完成回调（进审核队列）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { loadEnv } from '../env';
import {
  getMyProfile,
  getTherapistView,
  upsertProfile,
  listTherapists,
  type TherapistContext,
} from '../services/therapists';
import { finalizeMedia, issueUploadUrl, type MediaContext } from '../services/media';
import { personalizeRanking } from '../services/personalize';

function tctx(): TherapistContext {
  return { db: getDb() };
}
function mctx(): MediaContext {
  const env = loadEnv();
  return {
    db: getDb(),
    r2PublicBase: env.NODE_ENV === 'production' ? 'https://media.loverush.com' : undefined,
  };
}

const PatchBody = z.object({
  bio: z.string().max(500).optional(),
  bioTranslations: z.record(z.string()).optional(),
  tags: z.array(z.string().max(20)).max(20).optional(),
  nationality: z.string().max(40).optional(),
  languages: z.array(z.string()).max(10).optional(),
  avatarUrl: z.string().url().optional(),
  voiceIntroUrl: z.string().url().optional(),
  shortVideoUrl: z.string().url().optional(),
  galleryJson: z
    .array(
      z.object({
        url: z.string().url(),
        isPaid: z.boolean(),
        thumbnailUrl: z.string().url().optional(),
        pricePoints: z.number().int().nonnegative().optional(),
      }),
    )
    .max(50)
    .optional(),
  serviceCountry: z.string().max(40).optional(),
  serviceCity: z.string().max(40).optional(),
  serviceArea: z.string().max(80).optional(),
  serviceMode: z.enum(['outcall', 'incall', 'both']).optional(),
  // 到店服务 · 门店完整地址(写 serviceAddressFullEncrypted)
  serviceAddressFull: z.string().max(500).optional(),
  // 到店服务 · 到店须知
  shopArrivalNote: z.string().max(200).optional(),
  // 到店服务 · 找店指引图/视频(mediaId 须属于本技师,非法项后端剔除)
  shopGuideMedia: z
    .array(
      z.object({
        mediaId: z.string().uuid(),
        kind: z.enum(['image', 'video']),
        caption: z.string().max(120).optional(),
      }),
    )
    .max(9)
    .optional(),
  heightCm: z.number().int().min(140).max(220).optional(),
  weightKg: z.number().int().min(35).max(150).optional(),
  bustCm: z.number().int().min(60).max(140).optional(),
  hipCm: z.number().int().min(60).max(140).optional(),
  bodyFatPct: z.number().min(5).max(45).optional(),
  education: z.string().max(40).optional(),
  skillsJson: z
    .array(z.object({ skill: z.string(), level: z.number().int().min(1).max(5), certUrl: z.string().url().optional() }))
    .max(30)
    .optional(),
  basePriceJson: z
    .array(
      z.object({
        duration: z.number().int().positive(),
        // 老积分模式 · 新 fiat 模式后端会算回填
        pricePoints: z.number().int().nonnegative().optional(),
        // 0027 法币模式 · 给了 currencyCode+priceFiat 后端走 fx.convertFiatToPoints 算 pricePoints
        currencyCode: z.string().min(2).max(8).optional(),
        priceFiat: z.number().positive().max(999_999_999).optional(),
      }),
    )
    .max(20)
    .optional(),
  preferencesJson: z
    .object({
      preferredCustomerTypes: z.array(z.string()).optional(),
      rejectedCustomerTypes: z.array(z.string()).optional(),
      acceptableBehaviors: z.array(z.string()).optional(),
      unacceptableBehaviors: z.array(z.string()).optional(),
    })
    .optional(),
  onlineStatus: z.enum(['online', 'offline']).optional(),
});

const MediaInitBody = z
  .object({
    purpose: z.enum(['avatar', 'voice_intro', 'short_video', 'gallery', 'liveness', 'chat_attachment', 'shop_guide']),
    mime_type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    size_bytes: z.number().int().positive(),
    ext: z.string().regex(/^[a-z0-9]{1,8}$/i),
  })
  // 找店指引图/视频 · 仅允许 image/* 与 mp4/webm/quicktime(走现有审核)
  .refine(
    (b) =>
      b.purpose !== 'shop_guide' ||
      b.mime_type.startsWith('image/') ||
      ['video/mp4', 'video/webm', 'video/quicktime'].includes(b.mime_type),
    { message: 'shop_guide 仅支持图片或 mp4/webm/quicktime 视频', path: ['mime_type'] },
  );

const MediaFinalizeBody = z.object({
  media_id: z.string().uuid(),
  actual_size_bytes: z.number().int().positive().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  width_px: z.number().int().positive().optional(),
  height_px: z.number().int().positive().optional(),
  thumbnail_url: z.string().url().optional(),
  visibility: z.enum(['public', 'paid_unlock', 'platform_only']).optional(),
  unlock_price_points: z.number().int().nonnegative().optional(),
});

export const therapistRoutes = new Hono();

// ── M07 PUBLIC · 可约时段(不需 auth · 公开给所有用户查)──
// 必须在 use('*', requireAuth) 之前 · 否则被全局 auth 中间件劫持
import { computeAvailability } from '../services/availability';
import { zValidator as zv2 } from '@hono/zod-validator';
const AvailabilityQuery2 = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  duration: z.coerce.number().int().min(15).max(480).optional(),
});
therapistRoutes.get('/:userId/availability', zv2('query', AvailabilityQuery2), async (c) => {
  const therapistUserId = c.req.param('userId');
  const q = c.req.valid('query');
  const slots = await computeAvailability(getDb(), {
    therapistUserId,
    date: q.date,
    durationMinutes: q.duration,
  });
  c.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  return c.json({ data: { slots } });
});

therapistRoutes.use('*', requireAuth);

therapistRoutes.get('/', async (c) => {
  const city = c.req.query('city');
  const online = c.req.query('online');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  const search = c.req.query('search');
  const heightMin = c.req.query('height_min');
  const heightMax = c.req.query('height_max');
  const nationality = c.req.query('nationality');
  const language = c.req.query('language');
  const skill = c.req.query('skill');
  const scoreMin = c.req.query('score_min');
  const priceMax = c.req.query('price_max');
  // M02 Phase 5 · 字典 uuid 精准撮合(优先于旧 city text)
  const cityId = c.req.query('city_id');
  const areaId = c.req.query('area_id');
  // 发现页 · 地理距离(lat+lng 同时传才启用 · radius_km 可选)
  const lat = c.req.query('lat');
  const lng = c.req.query('lng');
  const radiusKm = c.req.query('radius_km');
  // 发现页 · 综合评分下限(0-10 · 「9分天花板」传 min_rating=9)
  const minRating = c.req.query('min_rating');
  // Phase 3 · 个性化排序开关
  const personalize = c.req.query('personalize') === 'true';

  // float 解析:NaN → undefined(忽略该参数)
  const parseFloatOrUndef = (v: string | undefined): number | undefined => {
    if (v == null || v === '') return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const latNum = parseFloatOrUndef(lat);
  const lngNum = parseFloatOrUndef(lng);
  const result = await listTherapists(tctx(), {
    city: city || undefined,
    online: online === 'true' ? true : online === 'false' ? false : undefined,
    limit: limit ? Math.max(1, parseInt(limit, 10) || 20) : undefined,
    offset: offset ? Math.max(0, parseInt(offset, 10) || 0) : undefined,
    search: search || undefined,
    heightMin: heightMin ? parseInt(heightMin, 10) || undefined : undefined,
    heightMax: heightMax ? parseInt(heightMax, 10) || undefined : undefined,
    nationality: nationality || undefined,
    language: language || undefined,
    skill: skill || undefined,
    scoreMin: scoreMin ? parseInt(scoreMin, 10) || undefined : undefined,
    priceMax: priceMax ? parseInt(priceMax, 10) || undefined : undefined,
    cityId: cityId || undefined,
    areaId: areaId || undefined,
    // 地理:lat+lng 同时有效才传(radiusKm 仅在两者齐全时才有意义)
    lat: latNum != null && lngNum != null ? latNum : undefined,
    lng: latNum != null && lngNum != null ? lngNum : undefined,
    radiusKm: latNum != null && lngNum != null ? parseFloatOrUndef(radiusKm) : undefined,
    minRating: (() => {
      const n = parseFloatOrUndef(minRating);
      if (n == null) return undefined;
      // 夹到 0-10
      return Math.min(Math.max(n, 0), 10);
    })(),
  });

  // Phase 3 · 个性化重排序 · 失败时静默退回原顺序
  if (personalize && result.data.length > 0) {
    try {
      const userId = c.get('userId') as string;
      const ranked = await personalizeRanking({ db: getDb() }, userId, result.data);
      const personalized = ranked.map((r) => ({
        ...r.therapist,
        match_score: r.score,
        match_reasons: r.reasons,
      }));
      return c.json({
        data: personalized,
        meta: { total: result.total, personalized: true },
      });
    } catch {
      // 个性化失败 · 退回原顺序(降级 · 不影响搜索)
    }
  }

  return c.json({ data: result.data, meta: { total: result.total } });
});

therapistRoutes.get('/me', async (c) => {
  const view = await getMyProfile(tctx(), c.get('userId'));
  return c.json({ data: view });
});

therapistRoutes.put('/me', zValidator('json', PatchBody), async (c) => {
  const body = c.req.valid('json');
  // bodyFatPct 是 number，但 schema 列是 numeric，drizzle 会接 string；这里转回 string
  // 0027 basePriceJson 每档 pricePoints 可能为 undefined(fiat 模式 · 服务端会回填)→ 兜底 0
  // upsertProfile 内部检测 currencyCode+priceFiat 时会重算 pricePoints
  const normalizedBasePrice = body.basePriceJson?.map((p) => ({
    duration: p.duration,
    pricePoints: p.pricePoints ?? 0,
    currencyCode: p.currencyCode,
    priceFiat: p.priceFiat,
  }));
  // 到店地址:入参 serviceAddressFull → 列 serviceAddressFullEncrypted(当前为明文存储,沿用既有约定)
  const { serviceAddressFull, ...rest } = body;
  const patch = {
    ...rest,
    bodyFatPct: body.bodyFatPct !== undefined ? String(body.bodyFatPct) : undefined,
    basePriceJson: normalizedBasePrice,
    ...(serviceAddressFull !== undefined ? { serviceAddressFullEncrypted: serviceAddressFull } : {}),
  };
  const view = await upsertProfile(tctx(), c.get('userId'), patch);
  return c.json({ data: view });
});

therapistRoutes.post('/me/media/upload-init', zValidator('json', MediaInitBody), async (c) => {
  const body = c.req.valid('json');
  const result = await issueUploadUrl(mctx(), {
    ownerUserId: c.get('userId'),
    purpose: body.purpose,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
    ext: body.ext,
  });
  return c.json({ data: result });
});

therapistRoutes.post('/me/media/finalize', zValidator('json', MediaFinalizeBody), async (c) => {
  const body = c.req.valid('json');
  const result = await finalizeMedia(mctx(), {
    mediaId: body.media_id,
    ownerUserId: c.get('userId'),
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

// M11 Phase 1 · 技师查看自己所有媒体 + 审核状态(反馈闭环)
therapistRoutes.get('/me/media', async (c) => {
  const userId = c.get('userId') as string;
  const purpose = c.req.query('purpose');
  const { mediaAssets, contentAuditRecords } = await import('@loverush/db');
  const { and: andFn, eq: eqFn, isNull, desc } = await import('drizzle-orm');

  const where = purpose
    ? andFn(
        eqFn(mediaAssets.ownerUserId, userId),
        isNull(mediaAssets.deletedAt),
        eqFn(mediaAssets.purpose, purpose),
      )
    : andFn(eqFn(mediaAssets.ownerUserId, userId), isNull(mediaAssets.deletedAt));

  const rows = await getDb()
    .select()
    .from(mediaAssets)
    .where(where)
    .orderBy(desc(mediaAssets.createdAt))
    .limit(200);

  // 关联各 media 最近一条 audit 工单的 rejectReason(rejected 时 UI 要显示)
  const mediaIds = rows.map((r) => r.id);
  const rejectReasonByMediaId: Record<string, string | null> = {};
  if (mediaIds.length > 0) {
    const audits = await getDb()
      .select({
        targetId: contentAuditRecords.targetId,
        rejectReason: contentAuditRecords.rejectReason,
        status: contentAuditRecords.status,
        decidedAt: contentAuditRecords.decidedAt,
      })
      .from(contentAuditRecords)
      .where(eqFn(contentAuditRecords.targetType, 'media'));
    for (const a of audits) {
      if (!a.targetId || !mediaIds.includes(a.targetId)) continue;
      // 仅记录已驳回的 rejectReason
      if (a.status === 'rejected' && a.rejectReason) {
        rejectReasonByMediaId[a.targetId] = a.rejectReason;
      }
    }
  }

  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      purpose: r.purpose,
      publicUrl: r.publicUrl,
      thumbnailUrl: r.thumbnailUrl,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      durationMs: r.durationMs,
      widthPx: r.widthPx,
      heightPx: r.heightPx,
      visibility: r.visibility,
      unlockPricePoints: r.unlockPricePoints,
      auditStatus: r.auditStatus,
      rejectReason: rejectReasonByMediaId[r.id] ?? null,
      createdAt: r.createdAt,
    })),
  });
});

therapistRoutes.get('/:id', async (c) => {
  const therapistId = c.req.param('id');
  const viewerUserId = c.get('userId') as string | undefined;

  // D-203 · 真查 paywall.isUnlocked 状态
  let viewerHasPaid = false;
  if (viewerUserId) {
    const paywall = await import('../services/paywall');
    const unlocked = await paywall.listUnlocked(
      { db: getDb() },
      viewerUserId,
      therapistId,
    );
    viewerHasPaid = unlocked.includes('social_contacts') || unlocked.includes('gallery_paid');
  }

  const view = await getTherapistView(tctx(), { therapistId, viewerUserId, viewerHasPaid });
  return c.json({ data: view });
});

// ──────────────────── M02 Phase 6 · 收藏 ────────────────────

therapistRoutes.post('/:id/favorite', async (c) => {
  const therapistId = c.req.param('id');
  const customerId = c.get('userId') as string;
  const { favorites } = await import('@loverush/db');
  await getDb()
    .insert(favorites)
    .values({ customerId, therapistId })
    .onConflictDoNothing();
  return c.json({ data: { ok: true, isFavorite: true } });
});

therapistRoutes.delete('/:id/favorite', async (c) => {
  const therapistId = c.req.param('id');
  const customerId = c.get('userId') as string;
  const { favorites } = await import('@loverush/db');
  const { and: andFn, eq: eqFn } = await import('drizzle-orm');
  await getDb()
    .delete(favorites)
    .where(andFn(eqFn(favorites.customerId, customerId), eqFn(favorites.therapistId, therapistId)));
  return c.json({ data: { ok: true, isFavorite: false } });
});
