/**
 * 公开法币 + 汇率端点 · 0027 模型
 *
 * GET /currencies  返 active 法币 + 每个 currency 最新汇率
 *   供技师发布 shows 时选币种 / 客户端展示换算 hint
 */

import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { currencies, exchangeRates } from '@loverush/db';
import { getDb } from '../db';

export const publicCurrencyRoutes = new Hono();

publicCurrencyRoutes.get('/', async (c) => {
  const db = getDb();
  // 仅 active 字典
  const list = await db.query.currencies.findMany({
    where: eq(currencies.isActive, 1),
    orderBy: [currencies.displayOrder, currencies.code],
  });

  // 每个 currency 最新 rate
  const codes = list.map((x) => x.code);
  if (codes.length === 0) return c.json({ data: [] });

  const allRates = await db.query.exchangeRates.findMany({
    orderBy: [desc(exchangeRates.effectiveAt)],
  });
  const latestByCode = new Map<string, string>();
  for (const r of allRates) {
    if (!latestByCode.has(r.currencyCode)) {
      latestByCode.set(r.currencyCode, r.pointsPerUnit);
    }
  }

  return c.json({
    data: list.map((x) => ({
      code: x.code,
      symbol: x.symbol,
      nameZh: x.nameZh,
      nameEn: x.nameEn,
      decimals: x.decimals,
      displayOrder: x.displayOrder,
      pointsPerUnit: latestByCode.get(x.code) ?? null, // numeric string · 客户端 parseFloat
    })),
  });
});
