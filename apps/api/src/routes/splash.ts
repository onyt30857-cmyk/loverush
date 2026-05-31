/**
 * 启动页配置 · public + admin · 简化版
 *
 * 暂用 feature_flags 表 metadata 字段存 image url 数组,
 * 等 R2 SDK 真集成后做 multipart 上传:
 *
 *   feature_flags row:
 *     key='splash.customer' / 'splash.therapist'
 *     metadata={ images: ['https://r2/...', 'https://r2/...', ...] }
 *
 * Endpoints:
 *   GET  /splash/config?scope=customer|therapist  · public · 客户端 splash 页拉
 *   POST /admin/splash/config                     · admin only · 写入 image urls
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { featureFlags } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { recordAudit } from '../services/audit';

const ScopeQuery = z.object({
  scope: z.enum(['customer', 'therapist']),
});

const ConfigBody = z.object({
  scope: z.enum(['customer', 'therapist']),
  images: z.array(z.string().url()).min(0).max(10),
});

const SCOPE_KEY = { customer: 'splash.customer', therapist: 'splash.therapist' } as const;

function defaultImages(scope: 'customer' | 'therapist'): string[] {
  return scope === 'therapist'
    ? ['/proto-images/splash-t-1.png', '/proto-images/splash-t-2.png']
    : [
        '/proto-images/splash-c-1.png',
        '/proto-images/splash-c-2.png',
        '/proto-images/splash-c-3.png',
        '/proto-images/splash-c-4.png',
      ];
}

// ── PUBLIC · 客户端拉 ────────────────────────────────────
export const splashRoutes = new Hono();

splashRoutes.get('/config', zValidator('query', ScopeQuery), async (c) => {
  const q = c.req.valid('query');
  const db = getDb();
  const row = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.key, SCOPE_KEY[q.scope]),
  });
  const meta = (row?.metadata ?? {}) as { images?: string[] };
  const images = meta.images && meta.images.length > 0 ? meta.images : defaultImages(q.scope);
  // 性能修复:splash 配置变更极少 · 让 Railway edge + 浏览器都缓存 5 分钟
  // stale-while-revalidate 10 分钟,意味着 5-15 分钟内再次访问即时返回
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  return c.json({ data: { scope: q.scope, images } });
});

// ── ADMIN · 写入 ────────────────────────────────────────
export const adminSplashRoutes = new Hono();
adminSplashRoutes.use('*', requireAuth, requireRole(['admin']));

adminSplashRoutes.get('/config', zValidator('query', ScopeQuery), async (c) => {
  const q = c.req.valid('query');
  const db = getDb();
  const row = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.key, SCOPE_KEY[q.scope]),
  });
  const meta = (row?.metadata ?? {}) as { images?: string[] };
  return c.json({
    data: {
      scope: q.scope,
      images: meta.images ?? [],
      defaults: defaultImages(q.scope),
      hasOverride: (meta.images?.length ?? 0) > 0,
    },
  });
});

adminSplashRoutes.post('/config', zValidator('json', ConfigBody), async (c) => {
  const body = c.req.valid('json');
  const db = getDb();
  const key = SCOPE_KEY[body.scope];

  const existing = await db.query.featureFlags.findFirst({
    where: eq(featureFlags.key, key),
  });

  if (existing) {
    await db
      .update(featureFlags)
      .set({
        metadata: { images: body.images },
        updatedAt: new Date(),
      })
      .where(eq(featureFlags.id, existing.id));
  } else {
    await db.insert(featureFlags).values({
      key,
      description: `${body.scope} 启动页图片配置(admin 可调)`,
      defaultEnabled: 1,
      rolloutBps: 10000,
      enabled: 1,
      metadata: { images: body.images },
    });
  }

  await recordAudit({ db }, c, {
    action: 'splash.config_update',
    targetType: 'splash_config',
    targetId: key,
    before: existing?.metadata ?? null,
    after: { images: body.images },
  });

  return c.json({ data: { ok: true, scope: body.scope, count: body.images.length } });
});
