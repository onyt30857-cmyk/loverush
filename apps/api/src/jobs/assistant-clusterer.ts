/**
 * Job · 多兴趣聚类
 *
 * 触发:每客户每天一次(扫近 7 天活跃客户)
 * 行为:调 clusterer.ts 的 clusterForUser,写 customer_interest_clusters
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { clusterForUser } from '../services/assistant/clusterer';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

export async function runClusterer(ctx: JobContext): Promise<{
  processed: number;
  withClusters: number;
}> {
  // 拉最近 7 天有任何 reference memory 写入的客户
  const rows = (await ctx.db.execute(sql`
    SELECT DISTINCT user_id
    FROM customer_reference_memory
    WHERE recorded_at >= NOW() - INTERVAL '7 days'
    LIMIT 1000
  `)) as unknown as Array<{ user_id: string }>;

  let withClusters = 0;
  for (const r of rows) {
    try {
      const res = await clusterForUser(ctx, r.user_id);
      if (res.clusters > 0) withClusters++;
    } catch (err) {
      logger.warn('assistant.clusterer.user_failed', { userId: r.user_id, err: String(err) });
    }
  }
  logger.info('assistant.clusterer.done', { processed: rows.length, withClusters });
  return { processed: rows.length, withClusters };
}

let timer: NodeJS.Timeout | null = null;
export function startClustererCron(ctx: JobContext, intervalMs = 24 * 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runClusterer(ctx).catch((err) => {
      logger.error('assistant.clusterer.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopClustererCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
