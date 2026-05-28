/**
 * Job · L3 rotating 归档到 L5 diff
 *
 * 触发:每日定时(setInterval 24h) · 也可手动 admin 触发
 * 行为:
 *   1. 扫所有 customer_reference_memory(rotating)中 valid_from > 30 天 + 未归档
 *   2. 把这部分软删(set archived_at, valid_to=NOW())
 *   3. 调 diff.ts 给每个客户跑跨次比对,派生 L5 写入
 *
 * 安全:全局扫表,跨 user_id 操作;依赖 admin role bypass RLS(部署侧配置)
 */

import { sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  customerReferenceMemory,
} from '@loverush/db';
import { archiveOldRotating } from '../services/assistant/memory';
import { diffForUser } from '../services/assistant/diff';
import { getGateway } from '../services/assistant/chat';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

const ARCHIVE_DAYS = 30;

export async function runArchiveRotating(ctx: JobContext): Promise<{
  archived: number;
  usersDiffed: number;
}> {
  const archived = await archiveOldRotating(ctx, ARCHIVE_DAYS);
  logger.info('assistant.archive_rotating.archived', { count: archived });

  // 拉受影响的 user_ids · 用 distinct
  const affected = (await ctx.db.execute(sql`
    SELECT DISTINCT user_id
    FROM customer_reference_memory
    WHERE archived_at IS NOT NULL
      AND archived_at >= NOW() - INTERVAL '1 day'
      AND memory_type = 'rotating'
    LIMIT 500
  `)) as unknown as Array<{ user_id: string }>;

  let usersDiffed = 0;
  for (const u of affected) {
    try {
      const written = await diffForUser(ctx, getGateway(), { userId: u.user_id });
      if (written > 0) usersDiffed++;
    } catch (err) {
      logger.warn('assistant.archive_rotating.diff_failed', { userId: u.user_id, err: String(err) });
    }
  }
  return { archived, usersDiffed };
}

let timer: NodeJS.Timeout | null = null;

/** 启动定时任务(每 24h) · 由 boot 入口调,默认仅在 production 启用 */
export function startArchiveRotatingCron(ctx: JobContext, intervalMs = 24 * 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runArchiveRotating(ctx).catch((err) => {
      logger.error('assistant.archive_rotating.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}

export function stopArchiveRotatingCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
