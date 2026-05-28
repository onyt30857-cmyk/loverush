/**
 * Job · 沉默召回 · 每日扫一次
 *
 * 触发:每日 10:00 UTC(setInterval 24h · 进程启动时立刻跑一次)
 * 流程:
 *   1. 扫 customer_outreach_state · last_order_at < NOW() - 30d · silent_recall_enabled=true
 *   2. 检 monthly cap(≤ 1)
 *   3. generateRecallMessage 生成话术
 *   4. 写 notifications(category='promo' · level='info')
 *   5. recordRecallSent 计数
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  canSendRecall,
  generateRecallMessage,
  recordRecallSent,
} from '../services/assistant/outreach';
import { enqueue } from '../services/notifications';
import { getGateway } from '../services/assistant/chat';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

export async function runSilentRecall(ctx: JobContext): Promise<{
  candidates: number;
  sent: number;
}> {
  const rows = (await ctx.db.execute(sql`
    SELECT user_id
    FROM customer_outreach_state
    WHERE silent_recall_enabled = true
      AND last_order_at IS NOT NULL
      AND last_order_at < NOW() - INTERVAL '30 days'
    LIMIT 500
  `)) as unknown as Array<{ user_id: string }>;

  let sent = 0;
  for (const r of rows) {
    try {
      const gate = await canSendRecall(ctx, r.user_id);
      if (!gate.ok) continue;
      const msg = await generateRecallMessage(ctx, getGateway(), r.user_id);
      if (!msg) continue;
      await enqueue(
        { db: ctx.db },
        {
          recipientUserId: r.user_id,
          category: 'promo',
          level: 'info',
          title: '小助理',
          body: msg,
          deepLink: '/assistant',
        },
      );
      await recordRecallSent(ctx, r.user_id);
      sent++;
    } catch (err) {
      logger.warn('assistant.silent_recall.user_failed', {
        userId: r.user_id,
        err: String(err),
      });
    }
  }
  logger.info('assistant.silent_recall.done', { candidates: rows.length, sent });
  return { candidates: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startSilentRecallCron(ctx: JobContext, intervalMs = 24 * 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runSilentRecall(ctx).catch((err) => {
      logger.error('assistant.silent_recall.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopSilentRecallCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
