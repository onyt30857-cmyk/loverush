/**
 * Admin · 第三方服务清单
 *
 * GET   /admin/integrations          列出平台用到的所有第三方服务 + 实时"已配置?"状态(脱敏)
 * PATCH /admin/integrations/:key     改非密钥字段(用途/启用/备注/非密钥参数/关键性/文档)
 *
 * 密钥本身不在本接口改(走 Railway env);本接口只读盘点凭证是否已配 + 维护服务元数据。
 * 仅 admin 角色。
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { systemIntegrations } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { recordAudit } from '../services/audit';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

export const adminIntegrationsRoutes = new Hono();
adminIntegrationsRoutes.use('*', requireAuth, requireRole(['admin']));

const SECRET_RE = /KEY|SECRET|TOKEN|DSN|PASSWORD|PRIVATE/i;

/** 读 process.env 判定某 env 变量状态(密钥脱敏只留末 4 位;非密钥可显示截断值) */
function envStatus(name: string): { name: string; present: boolean; preview: string | null } {
  const val = process.env[name];
  if (!val) return { name, present: false, preview: null };
  if (SECRET_RE.test(name)) {
    return { name, present: true, preview: `····${val.slice(-4)}` };
  }
  return { name, present: true, preview: val.length > 48 ? `${val.slice(0, 45)}…` : val };
}

adminIntegrationsRoutes.get('/', async (c) => {
  const rows = await getDb().query.systemIntegrations.findMany({
    orderBy: [asc(systemIntegrations.sortOrder)],
  });
  const data = rows.map((r) => {
    const env = r.envVars.map(envStatus);
    // 无 env 变量(如 fx 走 DB)视为 DB 配置;否则主凭证(第一个)存在即"已配置"
    const configSource: 'env' | 'db' = r.envVars.length === 0 ? 'db' : 'env';
    const configured = configSource === 'db' ? true : env[0]?.present === true;
    return { ...r, env, configSource, configured };
  });
  return c.json({ data });
});

const PatchBody = z.object({
  display_name: z.string().min(1).max(80).optional(),
  purpose: z.string().max(1000).optional(),
  category: z.string().max(40).optional(),
  criticality: z.enum(['critical', 'important', 'optional']).optional(),
  docs_url: z.string().url().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  config: z.record(z.unknown()).optional(),
});

adminIntegrationsRoutes.patch('/:key', zValidator('json', PatchBody), async (c) => {
  const key = c.req.param('key');
  const body = c.req.valid('json');
  const db = getDb();

  const existing = await db.query.systemIntegrations.findFirst({
    where: eq(systemIntegrations.key, key),
  });
  if (!existing) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, '该服务不存在');
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.display_name !== undefined) patch.displayName = body.display_name;
  if (body.purpose !== undefined) patch.purpose = body.purpose;
  if (body.category !== undefined) patch.category = body.category;
  if (body.criticality !== undefined) patch.criticality = body.criticality;
  if (body.docs_url !== undefined) patch.docsUrl = body.docs_url;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.config !== undefined) patch.config = body.config;

  const [row] = await db
    .update(systemIntegrations)
    .set(patch)
    .where(eq(systemIntegrations.key, key))
    .returning();

  await recordAudit({ db }, c, {
    action: 'integration.update',
    targetType: 'system_integration',
    targetId: key,
    before: { enabled: existing.enabled, config: existing.config },
    after: { enabled: row?.enabled, config: row?.config },
    reason: '改第三方服务元数据/参数',
  });

  return c.json({ data: row });
});
