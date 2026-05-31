/**
 * Job · 分身回复兜底补偿 · 每 3min 扫一次
 *
 * 修复 fire-and-forget 的固有弱点：客户发消息触发 maybeReplyAsAlter 时，
 * 若 API 正在部署重启 / LLM 崩 / 超时，这条回复会永久丢失，客户石沉大海。
 *
 * 流程：扫"客户最后发言 5min~24h 前、且技师/分身都还没回"的活跃会话
 *   → 补触发 maybeReplyAsAlter（内部再判 shouldFire：技师真在线就不补、让她自己回）
 * 这也会自动补回任何因部署窗口漏掉的回复。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { maybeReplyAsAlter } from '../services/ai_alter';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface RetryRow {
  conversation_id: string;
  customer_id: string;
  therapist_user_id: string;
}

export async function runAlterReplyRetry(ctx: JobContext): Promise<{ candidates: number; sent: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT c.id AS conversation_id, c.customer_id, c.therapist_user_id
    FROM conversations c
    JOIN therapists t ON t.user_id = c.therapist_user_id
    WHERE t.ai_alter_enabled = 1
      AND c.status = 'active'
      -- 客户最后发言 晚于 技师/分身最后发言（= 客户没被回）
      AND (SELECT max(sent_at) FROM messages WHERE conversation_id = c.id AND sender_user_id = c.customer_id)
          > COALESCE(
              (SELECT max(sent_at) FROM messages WHERE conversation_id = c.id AND sender_user_id = c.therapist_user_id),
              TIMESTAMP '1970-01-01'
            )
      -- 已过离线阈值(5min)但不太老(24h 内)
      AND (SELECT max(sent_at) FROM messages WHERE conversation_id = c.id AND sender_user_id = c.customer_id)
          < NOW() - INTERVAL '5 minutes'
      AND (SELECT max(sent_at) FROM messages WHERE conversation_id = c.id AND sender_user_id = c.customer_id)
          > NOW() - INTERVAL '24 hours'
    LIMIT 100
  `)) as unknown as RetryRow[];

  let sent = 0;
  for (const r of rows) {
    try {
      const res = await maybeReplyAsAlter(
        { db: ctx.db },
        {
          conversationId: r.conversation_id,
          customerId: r.customer_id,
          therapistUserId: r.therapist_user_id,
        },
      );
      if (res.replied) sent++;
    } catch (err) {
      logger.warn('ai_alter.retry.conv_failed', { conversationId: r.conversation_id, err: String(err) });
    }
  }
  logger.info('ai_alter.retry.done', { candidates: rows.length, sent });
  return { candidates: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startAlterReplyRetryCron(ctx: JobContext, intervalMs = 3 * 60 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runAlterReplyRetry(ctx).catch((err) => {
      logger.error('ai_alter.retry.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopAlterReplyRetryCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
