/**
 * 后台操作审计查询 · Phase 24 / 27
 *
 * GET /admin/audit-log         JSON  · 仅 admin 可查
 * GET /admin/audit-log.csv     CSV   · 仅 admin 可查 · 合规导出
 *   - 过滤：actor_user_id / actor_role / action / target_type / target_id / since / until
 *   - JSON 端点：limit (默认 50, 最大 200)
 *   - CSV 端点：limit (默认 5000, 最大 50000)；超大导出走归档脚本
 *
 * 安全：审计表是 append-only，本路由不提供 POST/PUT/DELETE
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { adminAuditLog } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';

export const adminAuditRoutes = new Hono();
adminAuditRoutes.use('*', requireAuth, requireRole(['admin']));

export const adminAuditCsvRoutes = new Hono();
adminAuditCsvRoutes.use('*', requireAuth, requireRole(['admin']));

const ListQuery = z.object({
  actor_user_id: z.string().uuid().optional(),
  actor_role: z.enum(['admin', 'finance', 'cs', 'auditor', 'ops', 'system']).optional(),
  action: z.string().max(80).optional(),
  target_type: z.string().max(40).optional(),
  target_id: z.string().max(80).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function buildConditions(q: {
  actor_user_id?: string;
  actor_role?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  since?: string;
  until?: string;
}): SQL | undefined {
  const conditions: SQL[] = [];
  if (q.actor_user_id) conditions.push(eq(adminAuditLog.actorUserId, q.actor_user_id));
  if (q.actor_role) conditions.push(eq(adminAuditLog.actorRole, q.actor_role));
  if (q.action) conditions.push(eq(adminAuditLog.action, q.action));
  if (q.target_type) conditions.push(eq(adminAuditLog.targetType, q.target_type));
  if (q.target_id) conditions.push(eq(adminAuditLog.targetId, q.target_id));
  if (q.since) conditions.push(gte(adminAuditLog.createdAt, new Date(q.since)));
  if (q.until) conditions.push(lte(adminAuditLog.createdAt, new Date(q.until)));
  return conditions.length ? and(...conditions) : undefined;
}

adminAuditRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await getDb()
    .select()
    .from(adminAuditLog)
    .where(buildConditions(q))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(q.limit);

  return c.json({ data: rows, count: rows.length });
});

// ───────────────────────── CSV 导出 ─────────────────────────

const CsvQuery = ListQuery.extend({
  limit: z.coerce.number().int().min(1).max(50_000).default(5000),
});

const CSV_COLUMNS = [
  'created_at',
  'actor_user_id',
  'actor_role',
  'action',
  'target_type',
  'target_id',
  'reason',
  'request_id',
  'ip',
  'user_agent',
  'before',
  'after',
] as const;

/** RFC 4180 安全转义 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // 双引号 + 内嵌双引号转义 + 含逗号/换行/双引号时强制引号包裹
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export { csvCell, CSV_COLUMNS }; // 供单元测试

adminAuditCsvRoutes.get('/', zValidator('query', CsvQuery), async (c) => {
  const q = c.req.valid('query');
  const rows = await getDb()
    .select()
    .from(adminAuditLog)
    .where(buildConditions(q))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(q.limit);

  const header = CSV_COLUMNS.join(',') + '\n';
  const body = rows
    .map((r) =>
      [
        r.createdAt.toISOString(),
        r.actorUserId ?? '',
        r.actorRole,
        r.action,
        r.targetType,
        r.targetId ?? '',
        r.reason ?? '',
        r.requestId ?? '',
        r.ip ?? '',
        r.userAgent ?? '',
        r.before,
        r.after,
      ]
        .map(csvCell)
        .join(','),
    )
    .join('\n');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new Response(header + body + (rows.length ? '\n' : ''), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${stamp}.csv"`,
      'X-Audit-Row-Count': String(rows.length),
    },
  });
});
