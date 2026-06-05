/**
 * Job · 订单待确认超时自动取消
 *
 * 触发:setInterval 5min(进程启动也跑一次)。
 * 流程:扫 status=PENDING_CONFIRM 且 进入待确认超过 2h(老订单用 created_at 兜底) →
 *      expirePendingConfirmOrder(取消+退还冻结心动金+通知双方)。
 *
 * 频率:5min 够用(几千订单不打 DB,1 query + 逐单处理)。幂等靠 expire 内部 status 检查。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { expirePendingConfirmOrder } from '../services/orders';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

/** 待确认超时时限(小时) */
const TIMEOUT_HOURS = 2;

interface DueRow {
  id: string;
}

export async function runOrderPendingConfirmTimeout(ctx: JobContext): Promise<{ due: number; expired: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT id FROM orders
    WHERE status = 'PENDING_CONFIRM'
      AND COALESCE(pending_confirm_at, created_at) < now() - INTERVAL '${sql.raw(String(TIMEOUT_HOURS))} hours'
    ORDER BY created_at
    LIMIT 100
  `)) as unknown as DueRow[];

  let expired = 0;
  for (const r of rows) {
    try {
      if (await expirePendingConfirmOrder({ db: ctx.db }, r.id)) expired++;
    } catch (err) {
      logger.error('order_pending_confirm_timeout.expire_failed', { orderId: r.id, err: String(err) });
    }
  }
  if (expired > 0) logger.info('order_pending_confirm_timeout.done', { due: rows.length, expired });
  return { due: rows.length, expired };
}

let timer: NodeJS.Timeout | null = null;
export function startOrderPendingConfirmTimeoutCron(ctx: JobContext, intervalMs = 5 * 60 * 1000): void {
  if (timer) return;
  void runOrderPendingConfirmTimeout(ctx).catch((err) =>
    logger.error('order_pending_confirm_timeout.bootstrap_failed', { err: String(err) }),
  );
  timer = setInterval(() => {
    runOrderPendingConfirmTimeout(ctx).catch((err) =>
      logger.error('order_pending_confirm_timeout.tick_failed', { err: String(err) }),
    );
  }, intervalMs);
}
