/**
 * 系统错误聚合 service · admin 监管 + 预警基础
 *
 * 调用入口:
 *   - middleware/errors.ts onErrorHandler 的"兜底未知异常"分支自动 recordSystemError
 *   - 业务 service 也可手动调(如 LLM 调用失败、外部 API 5xx)
 *
 * 设计:
 *   - fingerprint = md5(error_type + error_code + route + method) · 同 fingerprint 累加 count
 *   - upsert by partial unique index (fingerprint, resolved_at IS NULL)
 *   - resolved 后再触发同 fingerprint → 新建一行(回归追踪)
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { systemErrors, type SystemError } from '@loverush/db';
import { logger } from './logger';
import { sendAlertWebhook, sendAlertEmail } from './alerts';
import { loadEnv } from '../env';

export interface SystemErrorContext {
  db: Database;
}

export interface RecordSystemErrorArgs {
  errorType: 'server' | 'auth' | 'validation' | 'db' | 'external' | 'client';
  errorCode?: string | null;
  httpStatus?: number;
  route?: string;
  method?: string;
  message: string;
  stack?: string;
  /** 0-100 · >=80 触发高危预警 · 缺省按 errorType 自动推断 */
  severity?: number;
  sampleUserId?: string | null;
  sampleRequestId?: string | null;
  samplePayload?: Record<string, unknown>;
}

/** 推断默认 severity */
function inferSeverity(args: RecordSystemErrorArgs): number {
  if (args.severity !== undefined) return args.severity;
  switch (args.errorType) {
    case 'server':
      // 5xx · 默认高危(70 · 多次重复后自动升级)
      return args.httpStatus && args.httpStatus >= 500 ? 70 : 50;
    case 'db':
      return 80;
    case 'external':
      return 60;
    case 'auth':
      return 30;
    case 'validation':
      return 20;
    case 'client':
      return 30;
  }
}

function fingerprintOf(args: RecordSystemErrorArgs): string {
  const key = [
    args.errorType,
    args.errorCode ?? '',
    args.route ?? '',
    args.method ?? '',
  ].join('|');
  return createHash('md5').update(key).digest('hex');
}

/**
 * 记录 / 聚合系统错误
 *
 * - 同 fingerprint 未 resolved → count++ + last_seen_at=now + 样本覆盖
 * - 同 fingerprint 已 resolved 或新 fingerprint → INSERT 新行
 *
 * 失败时只 log · 永不阻塞调用方(防止 error log 死循环)
 */
export async function recordSystemError(
  ctx: SystemErrorContext,
  args: RecordSystemErrorArgs,
): Promise<void> {
  try {
    const fp = fingerprintOf(args);
    const sev = inferSeverity(args);

    // upsert by partial unique index (fingerprint where resolved_at IS NULL)
    // 用 ON CONFLICT 在 partial unique index 上 · RETURNING 拿到聚合后的 count(供 webhook 用)
    const rows = (await ctx.db.execute(sql`
      INSERT INTO system_errors (
        fingerprint, error_type, error_code, http_status, route, method,
        message, stack, severity, count, sample_user_id, sample_request_id, sample_payload
      )
      VALUES (
        ${fp}, ${args.errorType}, ${args.errorCode ?? null}, ${args.httpStatus ?? null},
        ${args.route ?? null}, ${args.method ?? null},
        ${args.message.slice(0, 500)}, ${args.stack?.slice(0, 4000) ?? null},
        ${sev}, 1,
        ${args.sampleUserId ?? null}, ${args.sampleRequestId ?? null},
        ${JSON.stringify(args.samplePayload ?? {})}::jsonb
      )
      ON CONFLICT (fingerprint) WHERE resolved_at IS NULL
      DO UPDATE SET
        count = system_errors.count + 1,
        last_seen_at = now(),
        message = EXCLUDED.message,
        stack = COALESCE(EXCLUDED.stack, system_errors.stack),
        sample_user_id = COALESCE(EXCLUDED.sample_user_id, system_errors.sample_user_id),
        sample_request_id = EXCLUDED.sample_request_id,
        sample_payload = EXCLUDED.sample_payload,
        severity = GREATEST(system_errors.severity, EXCLUDED.severity)
      RETURNING severity, count
    `)) as unknown as Array<{ severity: number; count: number }>;

    // V1+V2 预警 · severity 阈值不同
    //   - Webhook(Discord/Slack)  ≥ 80
    //   - Email(Resend)            ≥ 90 (邮件干扰大 · 阈值更严)
    const finalSev = rows[0]?.severity ?? sev;
    const finalCount = rows[0]?.count ?? 1;
    if (finalSev >= 80) {
      const env = loadEnv();
      const payload = {
        type: 'system_error' as const,
        severity: finalSev,
        fingerprint: fp,
        errorType: args.errorType,
        errorCode: args.errorCode,
        httpStatus: args.httpStatus,
        route: args.route,
        method: args.method,
        message: args.message,
        count: finalCount,
        admin_url: `${env.ADMIN_BASE_URL}/system-errors`,
        occurred_at: new Date().toISOString(),
      };
      void sendAlertWebhook(payload);
      if (finalSev >= 90) {
        void sendAlertEmail(payload);
      }
    }
  } catch (e) {
    // 仅 log 不抛 · 防错误收集自身死循环
    logger.error('system_errors.record_failed', {
      err: e instanceof Error ? e.message : String(e),
      args,
    });
  }
}

export interface ListSystemErrorsParams {
  unresolvedOnly?: boolean;
  errorType?: string;
  minSeverity?: number;
  limit?: number;
}

export async function listSystemErrors(
  ctx: SystemErrorContext,
  params: ListSystemErrorsParams = {},
): Promise<SystemError[]> {
  const conds = [];
  if (params.unresolvedOnly) conds.push(isNull(systemErrors.resolvedAt));
  if (params.errorType) conds.push(eq(systemErrors.errorType, params.errorType));
  if (params.minSeverity !== undefined) conds.push(gte(systemErrors.severity, params.minSeverity));
  return ctx.db.query.systemErrors.findMany({
    where: conds.length > 0 ? and(...conds) : undefined,
    orderBy: [desc(systemErrors.severity), desc(systemErrors.lastSeenAt)],
    limit: params.limit ?? 100,
  });
}

export async function resolveSystemError(
  ctx: SystemErrorContext,
  args: { id: string; resolverUserId: string; resolution: 'fixed' | 'wont_fix' | 'duplicate' | 'external' },
): Promise<void> {
  await ctx.db
    .update(systemErrors)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId: args.resolverUserId,
      resolution: args.resolution,
    })
    .where(and(eq(systemErrors.id, args.id), isNull(systemErrors.resolvedAt)));
}

/** dashboard widget 用 · 近 24h 高危未解决错误数 */
export async function countActiveHighSeverity(
  ctx: SystemErrorContext,
  minSeverity = 70,
): Promise<number> {
  const rows = await ctx.db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(systemErrors)
    .where(
      and(
        isNull(systemErrors.resolvedAt),
        gte(systemErrors.severity, minSeverity),
        gte(systemErrors.lastSeenAt, sql`NOW() - INTERVAL '24 hours'`),
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * 趋势图 widget 用 · 近 N 小时每小时按类型聚合的错误数
 * 返回 N 个 bucket(按小时),每个含 server/db/auth/external/total
 */
export async function getErrorTrend(
  ctx: SystemErrorContext,
  hours = 24,
): Promise<Array<{ hour: string; server: number; db: number; auth: number; external: number; total: number }>> {
  const rows = (await ctx.db.execute(sql`
    WITH hours AS (
      SELECT generate_series(
        date_trunc('hour', NOW() - INTERVAL '${sql.raw(String(hours - 1))} hours'),
        date_trunc('hour', NOW()),
        INTERVAL '1 hour'
      ) AS h
    ),
    occurrences AS (
      -- 每个 error 按 count 展开成多次 occurrence(用 first/last_seen 区间均分)
      -- 简化:把 last_seen_at 整段计 1 次(避免复杂时间窗 join · 误差可接受)
      SELECT
        date_trunc('hour', last_seen_at) AS h,
        error_type,
        count
      FROM system_errors
      WHERE last_seen_at >= NOW() - INTERVAL '${sql.raw(String(hours))} hours'
    )
    SELECT
      to_char(h.h, 'HH24:00') AS hour,
      COALESCE(SUM(CASE WHEN o.error_type = 'server' THEN o.count END), 0)::int AS server,
      COALESCE(SUM(CASE WHEN o.error_type = 'db' THEN o.count END), 0)::int AS db,
      COALESCE(SUM(CASE WHEN o.error_type = 'auth' THEN o.count END), 0)::int AS auth,
      COALESCE(SUM(CASE WHEN o.error_type = 'external' THEN o.count END), 0)::int AS external,
      COALESCE(SUM(o.count), 0)::int AS total
    FROM hours h
    LEFT JOIN occurrences o ON o.h = h.h
    GROUP BY h.h
    ORDER BY h.h
  `)) as unknown as Array<{
    hour: string;
    server: number;
    db: number;
    auth: number;
    external: number;
    total: number;
  }>;
  return rows;
}
