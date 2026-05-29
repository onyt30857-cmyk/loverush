/**
 * Admin · 通知群发路由 · M13 Phase 0
 *
 * 路径前缀: /admin/broadcasts
 * 权限:    requireRole(['admin','ops'])
 * 审计:    每次写操作走 recordAudit
 *
 * 端点:
 *   GET    /admin/broadcasts                       列表(分页 + status 过滤)
 *   GET    /admin/broadcasts/:id                   详情 + 投递统计
 *   POST   /admin/broadcasts/preview-audience      受众预览 · 返 count + sample 10 个
 *   POST   /admin/broadcasts                       创建草稿(status=draft)
 *   POST   /admin/broadcasts/:id/send              立即发送(同步触发 runBroadcast)
 *   DELETE /admin/broadcasts/:id                   仅 status=draft 可删
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import {
  notificationBroadcasts,
  notificationBroadcastDeliveries,
  type AudienceRule,
} from '@loverush/db';
import { previewAudience, runBroadcast } from '../services/broadcast';

export const adminBroadcastRoutes = new Hono();
adminBroadcastRoutes.use('*', requireAuth, requireRole(['admin', 'ops']));

// ──────────────────── zod schemas ────────────────────

const AudienceRuleSchema: z.ZodType<AudienceRule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all_active'), userType: z.enum(['customer', 'therapist']).optional() }),
  z.object({
    kind: z.literal('by_city'),
    cities: z.array(z.string()).min(1).max(20),
    userType: z.enum(['customer', 'therapist']).optional(),
  }),
  z.object({
    kind: z.literal('by_locale'),
    locales: z.array(z.string()).min(1).max(6),
    userType: z.enum(['customer', 'therapist']).optional(),
  }),
  z.object({
    kind: z.literal('dormant'),
    daysSince: z.number().int().min(1).max(365),
    userType: z.enum(['customer', 'therapist']),
  }),
  z.object({ kind: z.literal('high_value'), minOrders: z.number().int().min(1).max(1000) }),
]);

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable().optional(),
  body_translations: z
    .record(z.object({ title: z.string(), body: z.string().optional() }))
    .nullable()
    .optional(),
  level: z.enum(['critical', 'important', 'info', 'silent']).default('info'),
  category: z.enum(['promo', 'system']).default('promo'),
  deep_link: z.string().max(500).nullable().optional(),
  audience_rule: AudienceRuleSchema,
  channels: z.array(z.enum(['in_app', 'web_push'])).min(1),
  bypass_user_prefs: z.boolean().optional().default(false),
});

const PreviewBody = z.object({ audience_rule: AudienceRuleSchema });

// ──────────────────── 列表 + 详情 ────────────────────

adminBroadcastRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);
  const where = status ? eq(notificationBroadcasts.status, status) : undefined;
  const rows = await getDb()
    .select()
    .from(notificationBroadcasts)
    .where(where)
    .orderBy(desc(notificationBroadcasts.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json({ data: rows, meta: { limit, offset } });
});

adminBroadcastRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const bc = await getDb().query.notificationBroadcasts.findFirst({
    where: eq(notificationBroadcasts.id, id),
  });
  if (!bc) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'broadcast not found');

  // 投递分桶统计
  const buckets = (await getDb().execute(sql`
    SELECT status, COUNT(*)::int AS n
    FROM notification_broadcast_deliveries
    WHERE broadcast_id = ${id}
    GROUP BY status
  `)) as Array<{ status: string; n: number }>;
  const stats = { sent: 0, skipped: 0, failed: 0 } as Record<string, number>;
  for (const b of buckets) stats[b.status] = b.n;

  // 失败/skipped 明细 Top 20(给运营看到底为啥没投到)
  const samples = await getDb()
    .select()
    .from(notificationBroadcastDeliveries)
    .where(eq(notificationBroadcastDeliveries.broadcastId, id))
    .orderBy(desc(notificationBroadcastDeliveries.createdAt))
    .limit(20);

  return c.json({ data: { ...bc, stats, samples } });
});

// ──────────────────── 受众预览 ────────────────────

adminBroadcastRoutes.post('/preview-audience', zValidator('json', PreviewBody), async (c) => {
  const body = c.req.valid('json');
  const res = await previewAudience({ db: getDb() }, body.audience_rule);
  return c.json({ data: res });
});

// ──────────────────── 创建草稿 ────────────────────

adminBroadcastRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const roles = ((c.get('userRoles' as never) as string[] | undefined) ?? []) as string[];
  const isAdmin = roles.includes('admin');

  // bypassUserPrefs 仅 admin role 能勾 · 且 level 必须 critical
  if (body.bypass_user_prefs) {
    if (!isAdmin) {
      throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'only admin can bypass user prefs');
    }
    if (body.level !== 'critical') {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'bypass_user_prefs requires level=critical');
    }
  }

  // 预计算 audience_count(给草稿期看 + 发送前再确认)
  const preview = await previewAudience({ db: getDb() }, body.audience_rule);

  const [row] = await getDb()
    .insert(notificationBroadcasts)
    .values({
      createdByAdminId: userId,
      name: body.name,
      title: body.title,
      body: body.body ?? null,
      bodyTranslations: body.body_translations ?? null,
      level: body.level,
      category: body.category,
      deepLink: body.deep_link ?? null,
      audienceRule: body.audience_rule,
      audienceCount: preview.count,
      channels: body.channels,
      bypassUserPrefs: body.bypass_user_prefs ? 1 : 0,
      status: 'draft',
    })
    .returning();

  await recordAudit({ db: getDb() }, c, {
    action: 'broadcast.create',
    targetType: 'broadcast',
    targetId: row?.id ?? body.name,
    before: null,
    after: row ?? null,
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

// ──────────────────── 立即发送 ────────────────────

adminBroadcastRoutes.post('/:id/send', async (c) => {
  const id = c.req.param('id');
  const bc = await getDb().query.notificationBroadcasts.findFirst({
    where: eq(notificationBroadcasts.id, id),
  });
  if (!bc) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'broadcast not found');
  if (bc.status !== 'draft') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `cannot send broadcast in status=${bc.status}`);
  }

  // fire-and-forget runBroadcast · API 立即返回 status=sending
  void runBroadcast({ db: getDb() }, id).catch((err) => {
    // 异常已在 runBroadcast 内部 mark failed + log
    void err;
  });

  await recordAudit({ db: getDb() }, c, {
    action: 'broadcast.send',
    targetType: 'broadcast',
    targetId: id,
    before: { status: bc.status, audienceCount: bc.audienceCount },
    after: { status: 'sending' },
    actorRole: 'ops',
  });

  return c.json({ data: { id, status: 'sending', audienceCount: bc.audienceCount } });
});

// ──────────────────── 删除草稿 ────────────────────

adminBroadcastRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const bc = await getDb().query.notificationBroadcasts.findFirst({
    where: eq(notificationBroadcasts.id, id),
  });
  if (!bc) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'broadcast not found');
  if (bc.status !== 'draft') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `cannot delete broadcast in status=${bc.status}`);
  }
  await getDb().delete(notificationBroadcasts).where(eq(notificationBroadcasts.id, id));
  await recordAudit({ db: getDb() }, c, {
    action: 'broadcast.delete',
    targetType: 'broadcast',
    targetId: id,
    before: bc,
    after: null,
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});
