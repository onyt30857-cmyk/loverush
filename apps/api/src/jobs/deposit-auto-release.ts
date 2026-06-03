/**
 * Job · 心动金兜底自动释放 + HOLDING 过期告警 · 0027 模型
 *
 * 触发:setInterval 1h(进程启动也跑一次)
 *
 * 流程:
 *   1. **auto-release**: 订单 status=COMPLETED · completedAt < NOW()-24h ·
 *      deposit_status='HOLDING' → releaseDeposit(resolution=auto_complete)
 *      防技师按 [服务完成] 但 release 异常 / 老数据迁移漏(罕见,但兜底)
 *
 *   2. **过期 HOLDING 告警**:订单 scheduledAt < NOW()-48h · deposit_status='HOLDING'
 *      非终态 · 写聚合 system_error(fingerprint=deposit_overdue · 同 fp 累加 count)
 *      不自动 forfeit · admin 在 /admin/disputes 看 amber 高亮 · 手动仲裁
 *
 * 频率:1h 够用 · 千-万订单不打 DB(2 query each)
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { releaseDeposit } from '../services/deposits';
import { recordSystemError } from '../services/system_errors';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface AutoReleaseRow {
  order_id: string;
  customer_id: string;
  deposit_points: number;
  completed_at: string;
}

interface OverdueRow {
  order_id: string;
  order_no: string;
  deposit_points: number;
  scheduled_at: string;
  hours_overdue: number;
}

export async function runDepositAutoRelease(ctx: JobContext): Promise<{
  released: number;
  overdueAlerted: number;
}> {
  // ──── 步骤 1 · 完单 24h 兜底 release ────
  const completedRows = (await ctx.db.execute(sql`
    SELECT o.id AS order_id,
           o.customer_id,
           o.deposit_points,
           o.completed_at::text AS completed_at
    FROM orders o
    WHERE o.status = 'COMPLETED'
      AND o.completed_at IS NOT NULL
      AND o.completed_at < NOW() - INTERVAL '24 hours'
      AND o.deposit_status = 'HOLDING'
      AND o.deposit_points IS NOT NULL
      AND o.deposit_points > 0
    LIMIT 100
  `)) as unknown as AutoReleaseRow[];

  let released = 0;
  for (const r of completedRows) {
    try {
      await releaseDeposit({ db: ctx.db }, r.order_id, 'auto_complete');
      released += 1;
      logger.info('deposit_auto_release.released', {
        orderId: r.order_id,
        depositPoints: r.deposit_points,
        completedAt: r.completed_at,
      });
    } catch (err) {
      logger.error('deposit_auto_release.release_failed', {
        orderId: r.order_id,
        err: String(err),
      });
    }
  }

  // ──── 步骤 2 · HOLDING 时段过 48h 告警(不自动 forfeit · admin 手动仲裁) ────
  const overdueRows = (await ctx.db.execute(sql`
    SELECT o.id AS order_id,
           o.order_no,
           o.deposit_points,
           o.scheduled_at::text AS scheduled_at,
           EXTRACT(EPOCH FROM (NOW() - o.scheduled_at)) / 3600 AS hours_overdue
    FROM orders o
    WHERE o.scheduled_at IS NOT NULL
      AND o.scheduled_at < NOW() - INTERVAL '48 hours'
      AND o.deposit_status = 'HOLDING'
      AND o.status NOT IN ('COMPLETED', 'REVIEWED', 'CANCELLED', 'REFUNDED', 'CLOSED')
    ORDER BY o.scheduled_at ASC
    LIMIT 100
  `)) as unknown as OverdueRow[];

  let overdueAlerted = 0;
  // 用聚合 fingerprint 写一条 system_error · count 自然累加
  // 同 fp 多个订单 → sample_payload 覆盖为最早过期那一条(列表头)
  if (overdueRows.length > 0) {
    const sample = overdueRows[0]!;
    await recordSystemError(
      { db: ctx.db },
      {
        errorType: 'server',
        errorCode: 'DEPOSIT_HOLDING_OVERDUE',
        route: '/_internal/deposit-auto-release',
        method: 'CRON',
        message: `${overdueRows.length} 个订单心动金 HOLDING 超 48h · 需 admin 在 /admin/disputes 仲裁`,
        severity: 60, // 中危 · 不触发 80+ 高危预警 banner · 但进未解决列表
        samplePayload: {
          totalOverdue: overdueRows.length,
          earliestOrderId: sample.order_id,
          earliestOrderNo: sample.order_no,
          earliestScheduledAt: sample.scheduled_at,
          earliestHoursOverdue: Math.floor(sample.hours_overdue),
          earliestDepositPoints: sample.deposit_points,
        },
      },
    );
    overdueAlerted = overdueRows.length;
  }

  logger.info('deposit_auto_release.tick', { released, overdueAlerted });
  return { released, overdueAlerted };
}

let timer: NodeJS.Timeout | null = null;
export function startDepositAutoReleaseCron(
  ctx: JobContext,
  intervalMs = 1 * 3600 * 1000, // 1h
): void {
  if (timer) return;
  // 启动立跑一次(避免重启窗口积压)
  void runDepositAutoRelease(ctx).catch((err) => {
    logger.error('deposit_auto_release.bootstrap_failed', { err: String(err) });
  });
  timer = setInterval(() => {
    runDepositAutoRelease(ctx).catch((err) => {
      logger.error('deposit_auto_release.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}

export function stopDepositAutoReleaseCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
