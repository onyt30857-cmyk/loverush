/**
 * Job · 积分采购订单超时清理 · M16(补"订单永久卡死"这条流程跑不通)
 *
 *   1. created 超 2h 未付款 → expired(纯状态变更:采购是客户↔代理直接付法币,平台不持资金,取消安全)
 *   2. customer_paid 超 72h 代理仍未确认 → disputed(客户已付法币、代理没放积分=钱付了积分没到,
 *      绝不自动取消/退,转人工仲裁保护客户;disputeStatus='open' 供后台 /admin/redeem 类入口介入)
 *
 * 频率 1h(进程启动也跑一次)。复用 redeem-auto-confirm 范式。Railway 单实例假设。
 */
import type { Database } from '@loverush/db';
import { pointPurchaseOrders } from '@loverush/db';
import { and, eq, lt } from 'drizzle-orm';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

const CREATED_TTL_MS = 2 * 3600 * 1000; // 下单 2h 未付款即过期
const PAID_TTL_MS = 72 * 3600 * 1000; // 已付款 72h 代理未确认即转争议

export async function expireStalePurchases(ctx: JobContext): Promise<{ expired: number; disputed: number }> {
  const now = Date.now();
  let expired = 0;
  let disputed = 0;
  try {
    const exp = await ctx.db
      .update(pointPurchaseOrders)
      .set({ status: 'expired' })
      .where(
        and(
          eq(pointPurchaseOrders.status, 'created'),
          lt(pointPurchaseOrders.createdAt, new Date(now - CREATED_TTL_MS)),
        ),
      )
      .returning({ id: pointPurchaseOrders.id });
    expired = exp.length;
  } catch (err) {
    logger.error('purchase_expire.created_failed', { err: String(err) });
  }
  try {
    const dis = await ctx.db
      .update(pointPurchaseOrders)
      .set({ status: 'disputed', disputeStatus: 'open' })
      .where(
        and(
          eq(pointPurchaseOrders.status, 'customer_paid'),
          lt(pointPurchaseOrders.customerPaidAt, new Date(now - PAID_TTL_MS)),
        ),
      )
      .returning({ id: pointPurchaseOrders.id });
    disputed = dis.length;
  } catch (err) {
    logger.error('purchase_expire.disputed_failed', { err: String(err) });
  }
  logger.info('purchase_expire.tick', { expired, disputed });
  return { expired, disputed };
}

let timer: NodeJS.Timeout | null = null;
export function startPurchaseAutoExpireCron(ctx: JobContext, intervalMs = 3600 * 1000): void {
  if (timer) return;
  void expireStalePurchases(ctx).catch((err) =>
    logger.error('purchase_expire.bootstrap_failed', { err: String(err) }),
  );
  timer = setInterval(() => {
    expireStalePurchases(ctx).catch((err) => logger.error('purchase_expire.tick_failed', { err: String(err) }));
  }, intervalMs);
}
export function stopPurchaseAutoExpireCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
