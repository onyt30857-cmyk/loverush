/**
 * Job · 系统报错自动归档
 *
 * 触发:setInterval 6h(进程启动也跑一次)。
 * 流程:把 N 天没再复发的活跃报错(resolved_at IS NULL 且 last_seen_at < now-N天)标记已解决,
 *      resolution='auto_stale'。让后台「未解决」列表自维护,不靠人手点。
 *
 * 安全:同 fingerprint 若日后再发,recordSystemError 会新建一行 active(回归追踪),
 *      所以自动归档不会掩盖真复发——再发即重新浮出。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

/** 多少天没复发就自动归档 */
const STALE_DAYS = 7;

export async function runAutoResolveStaleErrors(ctx: JobContext): Promise<{ resolved: number }> {
  const rows = (await ctx.db.execute(sql`
    UPDATE system_errors
    SET resolved_at = now(), resolution = 'auto_stale'
    WHERE resolved_at IS NULL
      AND last_seen_at < now() - INTERVAL '${sql.raw(String(STALE_DAYS))} days'
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  const resolved = rows.length;
  if (resolved > 0) logger.info('auto_resolve_stale_errors.done', { resolved, staleDays: STALE_DAYS });
  return { resolved };
}

let timer: NodeJS.Timeout | null = null;
export function startAutoResolveStaleErrorsCron(ctx: JobContext, intervalMs = 6 * 60 * 60 * 1000): void {
  if (timer) return;
  void runAutoResolveStaleErrors(ctx).catch((err) =>
    logger.error('auto_resolve_stale_errors.bootstrap_failed', { err: String(err) }),
  );
  timer = setInterval(() => {
    runAutoResolveStaleErrors(ctx).catch((err) =>
      logger.error('auto_resolve_stale_errors.tick_failed', { err: String(err) }),
    );
  }, intervalMs);
}
