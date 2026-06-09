/**
 * 消费画像(spend tier) · 轻量推导
 *
 * getSpendTier：按客户累计给该技师的送礼积分推 whale/mid/light。
 *
 * 口径：
 *   ① 优先聚合 points_transaction 里 type='TIP_GIVE' + relatedUserId=therapistUserId 的 OUT 流水
 *      (打赏/送礼均走 TIP_GIVE · 目前唯一的礼物消费来源)
 *   ② 若 ① 读不到，fallback 到 relationship.totalTipPoints 字段（触发门控时同步写入的）
 *   ③ 读不到任何数据 → 默认 'mid'（失败安全，不阻断主链）
 *
 * 阈值（可改常量）：
 *   SPEND_TIER_WHALE_THRESHOLD = 5000 积分
 *   SPEND_TIER_LIGHT_THRESHOLD = 500  积分
 *
 * 调用频率：每次分身回复时读一次（不缓存），数据量小，单条 SUM 查询毫秒级。
 */

import { and, eq, sum } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { pointsTransaction, customerRelationshipProfile, therapists } from '@loverush/db';

export type SpendTier = 'whale' | 'mid' | 'light';

/** 鲸鱼阈值：累计送礼 >= 5000 积分 → whale */
export const SPEND_TIER_WHALE_THRESHOLD = 5000;
/** 轻消费阈值：累计送礼 < 500 积分 → light */
export const SPEND_TIER_LIGHT_THRESHOLD = 500;

export interface GetSpendTierArgs {
  customerId: string;
  therapistUserId: string;
}

/**
 * 推导消费画像档位 · 失败安全，读不到数据默认返回 'mid'
 */
export async function getSpendTier(
  db: Database,
  args: GetSpendTierArgs,
): Promise<SpendTier> {
  try {
    // ① 主路径：聚合 points_transaction 里该客户给该技师的礼物/打赏流水
    //    type='TIP_GIVE' direction='OUT'（客户出账）relatedUserId=therapistUserId
    const txnRows = await db
      .select({ total: sum(pointsTransaction.amount) })
      .from(pointsTransaction)
      .where(
        and(
          eq(pointsTransaction.userId, args.customerId),
          eq(pointsTransaction.type, 'TIP_GIVE'),
          eq(pointsTransaction.direction, 'OUT'),
          eq(pointsTransaction.relatedUserId, args.therapistUserId),
        ),
      );
    const txnTotal = Number(txnRows[0]?.total ?? 0);

    if (txnTotal > 0) {
      return tierForAmount(txnTotal);
    }

    // ② fallback：relationship.totalTipPoints（打赏累计，reactToGift 路径写入）
    //    需要先查 therapistId(therapists.id)
    const tRows = await db
      .select({ id: therapists.id })
      .from(therapists)
      .where(eq(therapists.userId, args.therapistUserId))
      .limit(1);
    const therapistId = tRows[0]?.id;
    if (therapistId) {
      const relRows = await db
        .select({ totalTipPoints: customerRelationshipProfile.totalTipPoints })
        .from(customerRelationshipProfile)
        .where(
          and(
            eq(customerRelationshipProfile.customerId, args.customerId),
            eq(customerRelationshipProfile.therapistId, therapistId),
          ),
        )
        .limit(1);
      const tipTotal = relRows[0]?.totalTipPoints ?? 0;
      if (tipTotal > 0) {
        return tierForAmount(tipTotal);
      }
    }

    // ③ 没有任何数据 → 默认 mid（失败安全）
    return 'mid';
  } catch (err) {
    console.warn('[spendTier] getSpendTier failed, fallback mid:', (err as Error)?.message);
    return 'mid';
  }
}

function tierForAmount(amount: number): SpendTier {
  if (amount >= SPEND_TIER_WHALE_THRESHOLD) return 'whale';
  if (amount < SPEND_TIER_LIGHT_THRESHOLD) return 'light';
  return 'mid';
}
