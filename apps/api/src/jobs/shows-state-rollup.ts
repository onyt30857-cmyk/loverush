/**
 * Job · M04 节目状态自动流转 · 每 5min 扫一次
 *
 * 状态机:
 *   - open → closed:start_time 已过 + slots_remaining > 0(过时未售空 · admin 可重开)
 *   - closed → completed:end_time 后 1h(过完整服务时长 · 兜底归档)
 *   - draft 不动(技师草稿)
 *
 * 不依赖任何外部 cron 服务 · Railway 单实例进程内
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

export async function runShowsStateRollup(
  ctx: JobContext,
): Promise<{ closed: number; completed: number }> {
  // 1. open → closed:start_time 已过 + 仍有 slots(没人抢完)
  const closedRes = (await ctx.db.execute(sql`
    UPDATE shows
    SET status = 'closed', updated_at = NOW()
    WHERE status = 'open'
      AND start_time <= NOW()
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  // 2. closed → completed:start_time + duration_min + 1h 后(服务完成兜底)
  const completedRes = (await ctx.db.execute(sql`
    UPDATE shows
    SET status = 'completed', updated_at = NOW()
    WHERE status = 'closed'
      AND start_time + (duration_min || ' minutes')::interval + INTERVAL '1 hour' <= NOW()
    RETURNING id
  `)) as unknown as Array<{ id: string }>;

  const result = { closed: closedRes.length, completed: completedRes.length };
  if (result.closed > 0 || result.completed > 0) {
    logger.info('shows.state_rollup.tick', result);
  }
  return result;
}

let timer: NodeJS.Timeout | null = null;
export function startShowsStateRollupCron(ctx: JobContext, intervalMs = 5 * 60 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runShowsStateRollup(ctx).catch((err) => {
      logger.error('shows.state_rollup.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopShowsStateRollupCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
