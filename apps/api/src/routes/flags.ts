/**
 * Feature Flag 路由 · Phase 6.1
 *
 * GET    /flags                                 我的全部 flag 状态
 * GET    /flags/:key                            我的单个 flag
 * admin
 * GET    /admin/flags                           列全部
 * PUT    /admin/flags/:key                      upsert
 * POST   /admin/flags/:key/overrides            为用户设 override
 * DELETE /admin/flags/:key/overrides/:userId
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { featureFlags } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  buildEvalContext,
  evaluateAllForUser,
  isEnabled,
  removeOverride,
  setOverride,
  upsert,
  type FlagContext,
} from '../services/flags';

function fctx(): FlagContext {
  return { db: getDb() };
}

export const flagRoutes = new Hono();
flagRoutes.use('*', requireAuth);

flagRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const evalCtx = await buildEvalContext(fctx(), userId);
  const flags = await evaluateAllForUser(fctx(), evalCtx);
  return c.json({ data: flags });
});

flagRoutes.get('/:key', async (c) => {
  const userId = c.get('userId');
  const evalCtx = await buildEvalContext(fctx(), userId);
  const enabled = await isEnabled(fctx(), c.req.param('key'), evalCtx);
  return c.json({ data: { key: c.req.param('key'), enabled } });
});

// ──────────────── admin ────────────────

const UpsertBody = z.object({
  description: z.string().max(500).optional(),
  default_enabled: z.boolean().optional(),
  rollout_bps: z.number().int().min(0).max(10000).optional(),
  target_user_type: z.enum(['customer', 'therapist']).nullable().optional(),
  target_locales: z.array(z.string()).max(20).optional(),
  target_cities: z.array(z.string()).max(50).optional(),
  target_min_app_version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  enabled: z.boolean().optional(),
});

const OverrideBody = z.object({
  user_id: z.string().uuid(),
  enabled: z.boolean(),
  reason: z.string().max(200).optional(),
});

import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';

export const adminFlagRoutes = new Hono();
adminFlagRoutes.use('*', requireAuth, requireRole(['admin', 'ops']));

adminFlagRoutes.get('/', async (c) => {
  const list = await getDb().query.featureFlags.findMany({ orderBy: [featureFlags.key] });
  return c.json({ data: list });
});

adminFlagRoutes.put('/:key', zValidator('json', UpsertBody), async (c) => {
  const body = c.req.valid('json');
  const key = c.req.param('key');
  const before = await getDb().query.featureFlags.findFirst({ where: eq(featureFlags.key, key) });
  const row = await upsert(fctx(), {
    key,
    description: body.description,
    defaultEnabled: body.default_enabled,
    rolloutBps: body.rollout_bps,
    targetUserType: body.target_user_type,
    targetLocales: body.target_locales,
    targetCities: body.target_cities,
    targetMinAppVersion: body.target_min_app_version,
    enabled: body.enabled,
  });
  await recordAudit(fctx(), c, {
    action: 'flag.upsert',
    targetType: 'flag',
    targetId: key,
    before: before
      ? {
          enabled: before.enabled,
          defaultEnabled: before.defaultEnabled,
          rolloutBps: before.rolloutBps,
          targetUserType: before.targetUserType,
        }
      : null,
    after: {
      enabled: row.enabled,
      defaultEnabled: row.defaultEnabled,
      rolloutBps: row.rolloutBps,
      targetUserType: row.targetUserType,
    },
    actorRole: 'ops',
  });
  return c.json({ data: row });
});

adminFlagRoutes.post('/:key/overrides', zValidator('json', OverrideBody), async (c) => {
  const body = c.req.valid('json');
  const key = c.req.param('key');
  await setOverride(fctx(), {
    flagKey: key,
    userId: body.user_id,
    enabled: body.enabled,
    reason: body.reason,
  });
  await recordAudit(fctx(), c, {
    action: 'flag.override.set',
    targetType: 'flag',
    targetId: key,
    after: { userId: body.user_id, enabled: body.enabled },
    reason: body.reason,
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});

adminFlagRoutes.delete('/:key/overrides/:userId', async (c) => {
  const key = c.req.param('key');
  const targetUserId = c.req.param('userId');
  await removeOverride(fctx(), { flagKey: key, userId: targetUserId });
  await recordAudit(fctx(), c, {
    action: 'flag.override.remove',
    targetType: 'flag',
    targetId: key,
    before: { userId: targetUserId },
    actorRole: 'ops',
  });
  return c.json({ data: { ok: true } });
});
