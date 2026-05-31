/**
 * Job · 拟人回复调度 tick · 默认每 4s 扫一次
 *
 * 配合"待回复"表实现"不秒回 + debounce 合并连发"：
 *   客户发消息 → chat.schedulePendingReply 登记一行(scheduledAt = now + 拟人延迟)，
 *   连发则同行 scheduledAt 往后推 = 只在最后一条后才回。
 *   本 tick 原子领取(DELETE ... RETURNING)所有到点的行 → 触发 maybeReplyAsAlter。
 *
 * 与 3min 兜底补偿 job 分工不重叠：
 *   - 本 tick：新消息的"秒级~分钟级"正常回复(0~5min 窗口)
 *   - retry  ：>5min 仍没回的深层兜底(丢消息/本 tick 崩了)
 * 真人技师在延迟窗口内自己回了 → 她在线 → maybeReplyAsAlter 内 shouldFire 判离线为假 → 不重复回。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { maybeReplyAsAlter, AI_ALTER_CONFIG } from '../services/ai_alter';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface DueRow {
  conversation_id: string;
  customer_id: string;
  therapist_user_id: string;
  customer_locale: string | null;
}

export async function runAlterPendingReply(ctx: JobContext): Promise<{ due: number; sent: number }> {
  // 原子领取到点行：DELETE ... RETURNING 一步取走并删除，避免与 debounce 重排/多 tick 竞争。
  // 只取 scheduled_at <= now()，被 debounce 推到未来的行不会被取走。
  const rows = (await ctx.db.execute(sql`
    DELETE FROM ai_alter_pending_reply
    WHERE id IN (
      SELECT id FROM ai_alter_pending_reply
      WHERE scheduled_at <= now()
      ORDER BY scheduled_at
      LIMIT 100
    )
    RETURNING conversation_id, customer_id, therapist_user_id, customer_locale
  `)) as unknown as DueRow[];

  let sent = 0;
  for (const r of rows) {
    try {
      const res = await maybeReplyAsAlter(
        { db: ctx.db },
        {
          conversationId: r.conversation_id,
          customerId: r.customer_id,
          therapistUserId: r.therapist_user_id,
          customerLocale: r.customer_locale ?? undefined,
        },
      );
      if (res.replied) sent++;
    } catch (err) {
      logger.warn('ai_alter.pending.conv_failed', { conversationId: r.conversation_id, err: String(err) });
    }
  }
  if (rows.length) logger.info('ai_alter.pending.done', { due: rows.length, sent });
  return { due: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startAlterPendingReplyCron(ctx: JobContext, intervalMs = AI_ALTER_CONFIG.pendingTickMs): void {
  if (timer) return;
  timer = setInterval(() => {
    runAlterPendingReply(ctx).catch((err) => {
      logger.error('ai_alter.pending.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopAlterPendingReplyCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
