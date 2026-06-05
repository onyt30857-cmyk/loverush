/**
 * Job · IN_SERVICE 超时自动收尾
 *
 * 触发:setInterval 1h(进程启动也跑一次)。
 * 背景:技师开了服务(IN_SERVICE)但忘点"完成",订单会永久卡在 IN_SERVICE、心动金一直冻着。
 *      原有兜底只覆盖 PENDING_CONFIRM(2h 自动取消)和 COMPLETED(24h 自动释放),IN_SERVICE 无兜底。
 * 流程:扫 status=IN_SERVICE 且 服务开始(started_at,缺则 scheduled_at)超 TIMEOUT_HOURS →
 *      completeService(→ COMPLETED + 释放客户心动金,对客户有利的安全方向)。
 *
 * 安全:服务已"开始"才会走到 IN_SERVICE;超 48h 没收尾极可能是技师漏点。自动完成会把冻结的
 *      心动金退还客户(completeService 内 releaseDeposit),方向对客户有利;幂等靠 transition 内状态检查。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { completeService } from '../services/orders';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

/** IN_SERVICE 多久没收尾就自动完成(小时) */
const TIMEOUT_HOURS = 48;

interface DueRow {
  id: string;
  therapist_user_id: string;
}

export async function runInServiceTimeout(ctx: JobContext): Promise<{ due: number; completed: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT id, therapist_user_id
    FROM orders
    WHERE status = 'IN_SERVICE'
      AND COALESCE(started_at, scheduled_at) < now() - INTERVAL '${sql.raw(String(TIMEOUT_HOURS))} hours'
    ORDER BY COALESCE(started_at, scheduled_at)
    LIMIT 100
  `)) as unknown as DueRow[];

  let completed = 0;
  for (const r of rows) {
    try {
      await completeService({ db: ctx.db }, r.id, r.therapist_user_id);
      completed++;
    } catch (err) {
      logger.error('in_service_timeout.complete_failed', { orderId: r.id, err: String(err) });
    }
  }
  if (completed > 0) logger.info('in_service_timeout.done', { due: rows.length, completed });
  return { due: rows.length, completed };
}

let timer: NodeJS.Timeout | null = null;
export function startInServiceTimeoutCron(ctx: JobContext, intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  void runInServiceTimeout(ctx).catch((err) =>
    logger.error('in_service_timeout.bootstrap_failed', { err: String(err) }),
  );
  timer = setInterval(() => {
    runInServiceTimeout(ctx).catch((err) =>
      logger.error('in_service_timeout.tick_failed', { err: String(err) }),
    );
  }, intervalMs);
}
