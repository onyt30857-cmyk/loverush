/**
 * 法币↔积分汇率换算服务 · 0027 模型核心
 *
 * - 从 exchange_rates 取该 currency 最新生效的 rate(effective_at DESC LIMIT 1)
 * - convertFiatToPoints(fiat, code) → 心动金/订单积分换算用
 * - formatFiat(amount, code) → 客户端显示 '฿1,500'(用 currencies.decimals)
 *
 * 缓存:内存 60s · 防高频订单创建打 DB
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { currencies, exchangeRates } from '@loverush/db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

export interface FxContext {
  db: Database;
}

// 内存缓存:60s · 避免每笔订单查 DB
const rateCache = new Map<string, { rate: number; expiresAt: number }>();
const decimalsCache = new Map<string, { decimals: number; expiresAt: number }>();
const symbolCache = new Map<string, { symbol: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/** 拿最新生效的汇率(numeric 转 number) */
export async function getLatestRate(
  ctx: FxContext,
  currencyCode: string,
): Promise<number> {
  const now = Date.now();
  const hit = rateCache.get(currencyCode);
  if (hit && hit.expiresAt > now) return hit.rate;

  const row = await ctx.db.query.exchangeRates.findFirst({
    where: eq(exchangeRates.currencyCode, currencyCode),
    orderBy: [desc(exchangeRates.effectiveAt)],
  });
  if (!row) {
    throw HttpError.badRequest(
      ErrorCode.E0001_INVALID_PARAM,
      `no exchange rate for currency ${currencyCode}`,
    );
  }
  const rate = parseFloat(row.pointsPerUnit);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw HttpError.internal(`invalid rate for ${currencyCode}: ${row.pointsPerUnit}`);
  }
  rateCache.set(currencyCode, { rate, expiresAt: now + CACHE_TTL_MS });
  return rate;
}

/**
 * 法币 → 积分 · Math.ceil(避免小数损失给客户)
 * 例:฿1500 × 3 积分/฿ = 4500 积分
 */
export async function convertFiatToPoints(
  ctx: FxContext,
  fiat: number,
  currencyCode: string,
): Promise<number> {
  if (!Number.isFinite(fiat) || fiat < 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `invalid fiat amount: ${fiat}`);
  }
  const rate = await getLatestRate(ctx, currencyCode);
  return Math.ceil(fiat * rate);
}

/** 积分 → 法币 · Math.floor(避免找零给客户) */
export async function convertPointsToFiat(
  ctx: FxContext,
  points: number,
  currencyCode: string,
): Promise<number> {
  if (!Number.isFinite(points) || points < 0) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `invalid points: ${points}`);
  }
  const rate = await getLatestRate(ctx, currencyCode);
  return Math.floor((points / rate) * 100) / 100;
}

/** 取 currencies.decimals + symbol(缓存 60s) */
async function getCurrencyMeta(
  ctx: FxContext,
  currencyCode: string,
): Promise<{ decimals: number; symbol: string }> {
  const now = Date.now();
  const dHit = decimalsCache.get(currencyCode);
  const sHit = symbolCache.get(currencyCode);
  if (dHit && sHit && dHit.expiresAt > now && sHit.expiresAt > now) {
    return { decimals: dHit.decimals, symbol: sHit.symbol };
  }
  const row = await ctx.db.query.currencies.findFirst({
    where: eq(currencies.code, currencyCode),
  });
  if (!row) {
    return { decimals: 2, symbol: currencyCode }; // 兜底
  }
  decimalsCache.set(currencyCode, { decimals: row.decimals, expiresAt: now + CACHE_TTL_MS });
  symbolCache.set(currencyCode, { symbol: row.symbol, expiresAt: now + CACHE_TTL_MS });
  return { decimals: row.decimals, symbol: row.symbol };
}

/**
 * 格式化法币 · '฿1,500.00'(THB decimals=2)/ 'Rp1,500,000'(IDR decimals=0)
 */
export async function formatFiat(
  ctx: FxContext,
  amount: number,
  currencyCode: string,
): Promise<string> {
  const { decimals, symbol } = await getCurrencyMeta(ctx, currencyCode);
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted}`;
}

/** 清缓存(admin 改汇率/字典后调) */
export function clearFxCache(): void {
  rateCache.clear();
  decimalsCache.clear();
  symbolCache.clear();
}
