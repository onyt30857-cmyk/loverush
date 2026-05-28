/**
 * 风控服务 · M11
 *
 * 1. 事件记录 + 查询
 * 2. IP 黑名单 / 设备指纹检测
 * 3. 价格守门：30 单偏差检测（技师 vs 自己历史价 + 平台中位价）
 *
 * 注：已撤功能（不在本服务实现）：
 *   - F11.3 反诱导小费 / NLP 加钟话术检测（决策 2026-05-21）
 *   - Polaris 反人贩问诊（v1 撤出）
 */

import { eq, and, desc, gte, isNull, sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  riskEvents,
  ipBlacklist,
  priceLockAudits,
  orders,
  type RiskEvent,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface RiskContext {
  db: Database;
}

// ──────────────── 事件记录 ────────────────

export async function recordRiskEvent(
  ctx: RiskContext,
  args: {
    subjectUserId?: string;
    subjectType: 'user' | 'therapist' | 'order' | 'device';
    eventType: string;
    severity?: number;
    payload?: Record<string, unknown>;
    relatedOrderId?: string;
  },
): Promise<RiskEvent> {
  const [row] = await ctx.db
    .insert(riskEvents)
    .values({
      subjectUserId: args.subjectUserId,
      subjectType: args.subjectType,
      eventType: args.eventType,
      severity: args.severity ?? 50,
      payload: args.payload ?? {},
      relatedOrderId: args.relatedOrderId,
    })
    .returning();
  if (!row) throw HttpError.internal('risk event insert failed');
  return row;
}

export async function listRiskEvents(
  ctx: RiskContext,
  q: { subjectUserId?: string; eventType?: string; unresolvedOnly?: boolean; limit?: number; offset?: number },
): Promise<RiskEvent[]> {
  const conds = [];
  if (q.subjectUserId) conds.push(eq(riskEvents.subjectUserId, q.subjectUserId));
  if (q.eventType) conds.push(eq(riskEvents.eventType, q.eventType));
  if (q.unresolvedOnly) conds.push(isNull(riskEvents.resolvedAt));

  return ctx.db.query.riskEvents.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(riskEvents.severity), desc(riskEvents.createdAt)],
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  });
}

export async function resolveRiskEvent(
  ctx: RiskContext,
  args: { eventId: string; adminUserId: string; resolution: 'dismiss' | 'warn' | 'suspend' | 'ban' },
): Promise<RiskEvent> {
  const [row] = await ctx.db
    .update(riskEvents)
    .set({ resolvedAt: new Date(), resolvedByUserId: args.adminUserId, resolution: args.resolution })
    .where(eq(riskEvents.id, args.eventId))
    .returning();
  if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'event not found');
  return row;
}

// ──────────────── IP 黑名单 ────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function isIpBlocked(ctx: RiskContext, ip: string): Promise<boolean> {
  const ipHash = await sha256Hex(ip);
  const row = await ctx.db.query.ipBlacklist.findFirst({ where: eq(ipBlacklist.ipHash, ipHash) });
  if (!row) return false;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export async function addIpToBlacklist(
  ctx: RiskContext,
  args: { ip: string; reason: string; severity?: number; expiresAt?: Date; addedByUserId?: string },
) {
  const ipHash = await sha256Hex(args.ip);
  await ctx.db
    .insert(ipBlacklist)
    .values({
      ipHash,
      reason: args.reason,
      severity: args.severity ?? 50,
      expiresAt: args.expiresAt,
      addedByUserId: args.addedByUserId,
    })
    .onConflictDoUpdate({
      target: ipBlacklist.ipHash,
      set: { reason: args.reason, expiresAt: args.expiresAt },
    });
}

// ──────────────── 价格守门 · 30 单偏差检测 ────────────────

const PRICE_GUARD_WINDOW = 30;
const PRICE_GUARD_DEVIATION_PCT_THRESHOLD = 50; // 单笔偏差 >50% 触发

/**
 * 计算指定技师的价格快照 + 触发处置
 * 应该由订单进入 PAID 状态后异步触发（M11 价格守门）
 */
export async function evaluatePriceGuard(
  ctx: RiskContext,
  therapistId: string,
): Promise<{ triggered: boolean; medianPrice: number; sampleSize: number; maxDeviationPct: number }> {
  const recentOrders = await ctx.db.query.orders.findMany({
    where: and(
      eq(orders.therapistId, therapistId),
      gte(orders.createdAt, new Date(Date.now() - 90 * 24 * 3600 * 1000)),
    ),
    orderBy: [desc(orders.createdAt)],
    limit: PRICE_GUARD_WINDOW,
  });

  if (recentOrders.length < 5) {
    return { triggered: false, medianPrice: 0, sampleSize: recentOrders.length, maxDeviationPct: 0 };
  }

  const prices = recentOrders.map((o) => Number(o.pricePoints)).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const medianPrice = prices.length % 2 === 0 ? (prices[mid - 1]! + prices[mid]!) / 2 : prices[mid]!;
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  let maxDevPct = 0;
  for (const p of prices) {
    if (medianPrice === 0) continue;
    const dev = Math.abs((p - medianPrice) / medianPrice) * 100;
    if (dev > maxDevPct) maxDevPct = dev;
  }

  const triggered = maxDevPct > PRICE_GUARD_DEVIATION_PCT_THRESHOLD;

  await ctx.db.insert(priceLockAudits).values({
    therapistId,
    windowStartAt: recentOrders[recentOrders.length - 1]!.createdAt,
    windowEndAt: recentOrders[0]!.createdAt,
    sampleSize: prices.length,
    medianPricePoints: Math.round(medianPrice),
    avgPricePoints: Math.round(avgPrice),
    maxDeviationPct: Math.round(maxDevPct),
    triggered: triggered ? 1 : 0,
    actionTaken: triggered ? 'warn' : 'none',
  });

  if (triggered) {
    await recordRiskEvent(ctx, {
      subjectType: 'therapist',
      eventType: 'price_deviation_high',
      severity: 70,
      payload: { therapistId, medianPrice, maxDevPct, sampleSize: prices.length },
    });
  }

  return {
    triggered,
    medianPrice: Math.round(medianPrice),
    sampleSize: prices.length,
    maxDeviationPct: Math.round(maxDevPct),
  };
}

// ──────────────── 设备多账户检测 ────────────────

export async function checkDeviceMultiAccount(
  ctx: RiskContext,
  args: { fingerprintHash: string; userId: string },
): Promise<{ flagged: boolean; otherUserCount: number }> {
  // device_fingerprints 表里同 fingerprint 的不同 user 数
  const result = await ctx.db.execute(sql`
    SELECT COUNT(DISTINCT user_id)::int AS cnt
    FROM device_fingerprints
    WHERE fingerprint_hash = ${args.fingerprintHash}
      AND user_id IS NOT NULL
      AND user_id != ${args.userId}
  `);
  const cnt = (result[0] as { cnt: number } | undefined)?.cnt ?? 0;

  if (cnt >= 3) {
    await recordRiskEvent(ctx, {
      subjectUserId: args.userId,
      subjectType: 'device',
      eventType: 'device_multi_account',
      severity: 60,
      payload: { fingerprintHash: args.fingerprintHash, otherUserCount: cnt },
    });
    return { flagged: true, otherUserCount: cnt };
  }
  return { flagged: false, otherUserCount: cnt };
}
