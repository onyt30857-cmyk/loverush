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
    .array(z.object({ duration: z.number().int().positive(), pricePoints: z.number().int().nonnegative() }))
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
});

const MediaInitBody = z.object({
  purpose: z.enum(['avatar', 'voice_intro', 'short_video', 'gallery', 'liveness', 'chat_attachment']),
  mime_type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  size_bytes: z.number().int().positive(),
  ext: z.string().regex(/^[a-z0-9]{1,8}$/i),
});

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

therapistRoutes.use('*', requireAuth);

therapistRoutes.get('/', async (c) => {
  const city = c.req.query('city');
  const online = c.req.query('online');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  const result = await listTherapists(tctx(), {
    city: city || undefined,
    online: online === 'true' ? true : online === 'false' ? false : undefined,
    limit: limit ? Math.max(1, parseInt(limit, 10) || 20) : undefined,
    offset: offset ? Math.max(0, parseInt(offset, 10) || 0) : undefined,
  });
  return c.json({ data: result.data, meta: { total: result.total } });
});

therapistRoutes.get('/me', async (c) => {
  const view = await getMyProfile(tctx(), c.get('userId') as string);
  return c.json({ data: view });
});

therapistRoutes.put('/me', zValidator('json', PatchBody), async (c) => {
  const body = c.req.valid('json');
  // bodyFatPct 是 number，但 schema 列是 numeric，drizzle 会接 string；这里转回 string
  const patch = { ...body, bodyFatPct: body.bodyFatPct !== undefined ? String(body.bodyFatPct) : undefined };
  const view = await upsertProfile(tctx(), c.get('userId') as string, patch as never);
  return c.json({ data: view });
});

therapistRoutes.post('/me/media/upload-init', zValidator('json', MediaInitBody), async (c) => {
  const body = c.req.valid('json');
  const result = await issueUploadUrl(mctx(), {
    ownerUserId: c.get('userId') as string,
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
    ownerUserId: c.get('userId') as string,
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

therapistRoutes.get('/:id', async (c) => {
  const therapistId = c.req.param('id');
  const viewerUserId = c.get('userId') as string | undefined;

  // D-203 · 真查 paywall.isUnlocked 状态
  let viewerHasPaid = false;
  if (viewerUserId) {
    const paywall = await import('../services/paywall');
    const unlocked = await paywall.listUnlocked(
      { db: getDb() } as Parameters<typeof paywall.listUnlocked>[0],
      viewerUserId,
      therapistId,
    );
    viewerHasPaid = unlocked.includes('social_contacts') || unlocked.includes('gallery_paid');
  }

  const view = await getTherapistView(tctx(), { therapistId, viewerUserId, viewerHasPaid });
  return c.json({ data: view });
});
