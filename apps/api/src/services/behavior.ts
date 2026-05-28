/**
 * 动态偏好画像 · M03 F03.35
 *
 * 按客户近 N 单的技师数 / 重复率 / 平均间隔 计算 behavior_mode：
 *   - steady   稳定型：同技师重复率高，间隔规律
 *   - explorer 尝鲜型：技师多样性高，重复率低
 *   - mixed    混合型：介于两者之间
 *
 * 用于 M04 推荐时调权（steady → 优先推荐过的技师；explorer → 优先新技师）
 */

import { and, eq, gte, desc } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  orders,
  customerBehaviorProfile,
  type CustomerBehaviorProfile,
} from '@loverush/db';

export interface BehaviorContext {
  db: Database;
}

const WINDOW_DAYS = 180;
const MIN_SAMPLE = 5;

export interface BehaviorComputeResult {
  mode: 'steady' | 'explorer' | 'mixed';
  confidence: number;
  totalOrders: number;
  uniqueTherapists: number;
  repeatRate: number; // 0-100
  avgIntervalDays: number;
}

export async function computeBehaviorMode(
  ctx: BehaviorContext,
  customerId: string,
): Promise<BehaviorComputeResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const list = await ctx.db.query.orders.findMany({
    where: and(eq(orders.customerId, customerId), gte(orders.createdAt, since)),
    orderBy: [desc(orders.createdAt)],
  });

  const total = list.length;
  if (total < MIN_SAMPLE) {
    return {
      mode: 'mixed',
      confidence: 30,
      totalOrders: total,
      uniqueTherapists: new Set(list.map((o) => o.therapistId)).size,
      repeatRate: 0,
      avgIntervalDays: 0,
    };
  }

  const unique = new Set(list.map((o) => o.therapistId)).size;
  const repeatRate = Math.round(((total - unique) / total) * 100);

  // 平均下单间隔
  let totalGapMs = 0;
  for (let i = 1; i < list.length; i++) {
    totalGapMs += list[i - 1]!.createdAt.getTime() - list[i]!.createdAt.getTime();
  }
  const avgIntervalDays = Math.round(totalGapMs / (list.length - 1) / (24 * 3600 * 1000));

  let mode: 'steady' | 'explorer' | 'mixed';
  let confidence: number;
  if (repeatRate >= 60 && avgIntervalDays <= 30) {
    mode = 'steady';
    confidence = Math.min(100, 50 + Math.floor(repeatRate / 2));
  } else if (repeatRate <= 20 && unique >= 5) {
    mode = 'explorer';
    confidence = Math.min(100, 50 + (unique - 5) * 5);
  } else {
    mode = 'mixed';
    confidence = 60;
  }

  return { mode, confidence, totalOrders: total, uniqueTherapists: unique, repeatRate, avgIntervalDays };
}

export async function upsertBehaviorProfile(
  ctx: BehaviorContext,
  customerId: string,
  computed: BehaviorComputeResult,
): Promise<CustomerBehaviorProfile> {
  const existing = await ctx.db.query.customerBehaviorProfile.findFirst({
    where: eq(customerBehaviorProfile.userId, customerId),
  });

  if (existing) {
    const [updated] = await ctx.db
      .update(customerBehaviorProfile)
      .set({
        behaviorMode: computed.mode,
        modeConfidence: computed.confidence,
        totalOrders: computed.totalOrders,
        uniqueTherapists: computed.uniqueTherapists,
        repeatRate: computed.repeatRate,
        avgOrderIntervalDays: computed.avgIntervalDays,
        lastComputedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customerBehaviorProfile.userId, customerId))
      .returning();
    return updated!;
  }

  const [created] = await ctx.db
    .insert(customerBehaviorProfile)
    .values({
      userId: customerId,
      behaviorMode: computed.mode,
      modeConfidence: computed.confidence,
      totalOrders: computed.totalOrders,
      uniqueTherapists: computed.uniqueTherapists,
      repeatRate: computed.repeatRate,
      avgOrderIntervalDays: computed.avgIntervalDays,
      lastComputedAt: new Date(),
    })
    .returning();
  return created!;
}
