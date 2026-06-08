/**
 * 平台收入记账 · 各抽成点差额统一入账(此前差额蒸发不可对账)。
 *
 * 单点封装,各抽成点(chatPass/companion/chatMediaUnlock/tips/paywall/deposits)
 * 算完技师分成后调一次,把差额记一行平台收入。避免逻辑漂移。
 * 不动用户 points 账本——只做平台侧收入记录(可对账/可报表)。
 */
import { platformRevenue, type Database } from '@loverush/db';

export interface PlatformRevenueContext {
  db: Database;
}

export type PlatformRevenueSource =
  | 'chat_pass'
  | 'companion'
  | 'chat_media'
  | 'tip'
  | 'paywall'
  | 'deposit_forfeit'
  | 'shop';

/**
 * 记一笔平台收入。amount<=0 直接跳过;(source, refId) 唯一索引保证幂等
 * (同一来源重复调不重复记)。失败不抛(平台记账失败绝不该拖垮主交易)。
 */
export async function recordPlatformRevenue(
  ctx: PlatformRevenueContext,
  args: {
    source: PlatformRevenueSource;
    amount: number;
    refId: string;
    customerUserId?: string;
    therapistUserId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) return;
  try {
    await ctx.db
      .insert(platformRevenue)
      .values({
        source: args.source,
        amount: Math.floor(args.amount),
        refId: args.refId,
        customerUserId: args.customerUserId,
        therapistUserId: args.therapistUserId,
        metadata: args.metadata ?? {},
      })
      .onConflictDoNothing();
  } catch (err) {
    // 平台记账是旁路:失败只记日志,绝不影响已完成的扣费/分成主交易
    console.warn('[platform-revenue] record failed:', (err as Error)?.message, { source: args.source, refId: args.refId });
  }
}
