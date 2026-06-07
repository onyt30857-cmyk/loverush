/**
 * Admin · 小程序运营配置
 * GET /admin/app-config           列出所有配置项(含 bot.*)
 * PUT /admin/app-config/:key       改某项 value/enabled + 审计;bot.commands 改动即时推 setMyCommands
 * 仅 admin 角色。
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { appConfig } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { recordAudit } from '../services/audit';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { clearAppConfigCache } from '../services/app-config';
import { setMyCommands } from '../services/telegram';

export const adminAppConfigRoutes = new Hono();
adminAppConfigRoutes.use('*', requireAuth, requireRole(['admin']));

adminAppConfigRoutes.get('/', async (c) => {
  const rows = await getDb().query.appConfig.findMany({
    orderBy: [asc(appConfig.scope), asc(appConfig.key)],
  });
  return c.json({ data: rows });
});

const PutBody = z.object({
  value: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

adminAppConfigRoutes.put('/:key', zValidator('json', PutBody), async (c) => {
  const key = c.req.param('key');
  const body = c.req.valid('json');
  const db = getDb();

  const existing = await db.query.appConfig.findFirst({ where: eq(appConfig.key, key) });
  if (!existing) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, '该配置项不存在');
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.value !== undefined) patch.value = body.value;
  if (body.enabled !== undefined) patch.enabled = body.enabled;

  const [row] = await db.update(appConfig).set(patch).where(eq(appConfig.key, key)).returning();
  clearAppConfigCache();

  // bot.commands 改动 → 即时推到 Telegram(setMyCommands)
  if (key === 'bot.commands' && row?.enabled) {
    const cmds = (row.value as { commands?: Array<{ command: string; description: string }> }).commands ?? [];
    if (Array.isArray(cmds) && cmds.length) {
      await setMyCommands(cmds);
    }
  }

  await recordAudit({ db }, c, {
    action: 'app_config.update',
    targetType: 'app_config',
    targetId: key,
    before: { value: existing.value, enabled: existing.enabled },
    after: { value: row?.value, enabled: row?.enabled },
    reason: '改小程序运营配置',
  });

  return c.json({ data: row });
});
