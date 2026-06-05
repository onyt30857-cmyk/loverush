/**
 * Job · 积分回收自动确认 + 超时退回 · M16 P1
 *
 *   1. agent_paid 超 24h 持有人无操作 → 自动 completed（积分释放给代理），防持有人收钱后赖账不放积分
 *   2. created/agent_accepted 超 7 天 无代理付款 → 解冻退回持有人，防持有人积分被长期锁
 *
 * 频率:1h（进程启动也跑一次）。Railway 单实例假设，多实例需分布式锁。
 */
import type { Database } from '@loverush/db';
import { autoConfirmPaidRedeems, expireStaleRedeems } from '../services/redeem';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

export async function runRedeemAutoConfirm(ctx: JobContext): Promise<{ confirmed: number; expired: number }> {
  let confirmed = 0;
  let expired = 0;
  try {
    confirmed = await autoConfirmPaidRedeems({ db: ctx.db });
  } catch (err) {
    logger.error('redeem_auto.confirm_failed', { err: String(err) });
  }
  try {
    expired = await expireStaleRedeems({ db: ctx.db });
  } catch (err) {
    logger.error('redeem_auto.expire_failed', { err: String(err) });
  }
  logger.info('redeem_auto.tick', { confirmed, expired });
  return { confirmed, expired };
}

let timer: NodeJS.Timeout | null = null;
export function startRedeemAutoConfirmCron(ctx: JobContext, intervalMs = 1 * 3600 * 1000): void {
  if (timer) return;
  void runRedeemAutoConfirm(ctx).catch((err) => {
    logger.error('redeem_auto.bootstrap_failed', { err: String(err) });
  });
  timer = setInterval(() => {
    runRedeemAutoConfirm(ctx).catch((err) => {
      logger.error('redeem_auto.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}

export function stopRedeemAutoConfirmCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
