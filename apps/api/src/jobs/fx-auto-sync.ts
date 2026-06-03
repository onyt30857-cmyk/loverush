/**
 * Job · 汇率外部同步 · 0027 法币模型 P1
 *
 * 触发:setInterval 24h(进程启动跑一次)
 *
 * 设计要点:
 *   1. USD 作为 admin 手定的锚(从 DB exchange_rates 最新 USD 取 pointsPerUsd)
 *      · 这是平台层面的"积分价值"基准 · 不能让外部 API 撼动
 *   2. 从 open.er-api.com 拉所有 active 币种相对 USD 汇率(免费 · 无 key)
 *      · 可通过 env FX_PROVIDER_URL 覆盖(fixer.io / exchangerate-api 等)
 *   3. 对每个非 USD 的 currency:
 *      新 rate = pointsPerUsd / (X per USD)
 *      e.g. USD 锚 100 pts/USD · THB/USD=35.5 → 1 THB = 100/35.5 = 2.82 pts
 *   4. **变化阈值保护**:若新 rate 跟最新 DB rate 偏差 >5% → 不写
 *      · 改为 recordSystemError 让 admin 在 /admin/exchange-rates 手动审
 *      · 保护点:大幅 fx 波动可能是 API 故障 / 数据错误
 *   5. 偏差 <=5% 自动 INSERT 新 exchange_rates 一条
 *      · 历史保留 · 老订单按下单时锁定 rate 不变
 *
 * 不在范围:
 *   - 不调 fixer.io(免费档 EUR base · 跨币转换麻烦)· 不接 paid plan
 *   - 不自动调整 USD 锚(admin 才有权改 USD 基准)
 */

import { desc, eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { currencies, exchangeRates } from '@loverush/db';
import { recordSystemError } from '../services/system_errors';
import { clearFxCache } from '../services/fx';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface FxApiResponse {
  result?: string; // 'success' | 'error'
  base_code?: string;
  rates?: Record<string, number>;
  // 错误情况
  error?: string;
}

const DEFAULT_URL = 'https://open.er-api.com/v6/latest/USD';
const VARIANCE_THRESHOLD = 0.05; // 5%

export async function runFxAutoSync(ctx: JobContext): Promise<{
  updated: number;
  flagged: number;
  skipped: number;
}> {
  const url = process.env.FX_PROVIDER_URL || DEFAULT_URL;
  const apiKey = process.env.FX_API_KEY;

  // ──── 拉外部汇率 ────
  let resp: FxApiResponse;
  try {
    const fetchUrl = apiKey ? `${url}${url.includes('?') ? '&' : '?'}apikey=${apiKey}` : url;
    const r = await fetch(fetchUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    resp = (await r.json()) as FxApiResponse;
  } catch (err) {
    await recordSystemError(ctx, {
      errorType: 'external',
      errorCode: 'FX_PROVIDER_FETCH_FAILED',
      route: '/_internal/fx-auto-sync',
      method: 'CRON',
      message: `汇率 API 拉取失败 · ${url} · ${String(err).slice(0, 200)}`,
      severity: 50,
    });
    logger.error('fx_auto_sync.fetch_failed', { url, err: String(err) });
    return { updated: 0, flagged: 0, skipped: 0 };
  }

  if (resp.result === 'error' || !resp.rates) {
    await recordSystemError(ctx, {
      errorType: 'external',
      errorCode: 'FX_PROVIDER_BAD_RESPONSE',
      route: '/_internal/fx-auto-sync',
      method: 'CRON',
      message: `汇率 API 响应异常 · ${resp.error ?? 'no rates'}`,
      severity: 50,
    });
    return { updated: 0, flagged: 0, skipped: 0 };
  }

  // ──── 读 USD 锚 ────
  const usdLatest = await ctx.db.query.exchangeRates.findFirst({
    where: eq(exchangeRates.currencyCode, 'USD'),
    orderBy: [desc(exchangeRates.effectiveAt)],
  });
  if (!usdLatest) {
    logger.warn('fx_auto_sync.no_usd_anchor');
    return { updated: 0, flagged: 0, skipped: 0 };
  }
  const pointsPerUsd = parseFloat(usdLatest.pointsPerUnit);
  if (!Number.isFinite(pointsPerUsd) || pointsPerUsd <= 0) {
    return { updated: 0, flagged: 0, skipped: 0 };
  }

  // ──── 读 active 币种 ────
  const activeList = await ctx.db.query.currencies.findMany({
    where: eq(currencies.isActive, 1),
  });

  let updated = 0;
  let flagged = 0;
  let skipped = 0;

  for (const cur of activeList) {
    if (cur.code === 'USD') {
      skipped += 1;
      continue;
    }
    const xPerUsd = resp.rates[cur.code];
    if (!xPerUsd || xPerUsd <= 0) {
      skipped += 1;
      continue;
    }

    // 算新 rate = pointsPerUsd / (X per USD)
    // 保留 4 位 decimals · 匹配 exchange_rates.points_per_unit 精度
    const newRate = pointsPerUsd / xPerUsd;
    if (!Number.isFinite(newRate) || newRate <= 0) {
      skipped += 1;
      continue;
    }
    const newRateStr = newRate.toFixed(4);

    // 取当前最新 rate 做偏差校验
    const curLatest = await ctx.db.query.exchangeRates.findFirst({
      where: eq(exchangeRates.currencyCode, cur.code),
      orderBy: [desc(exchangeRates.effectiveAt)],
    });

    if (curLatest) {
      const oldRate = parseFloat(curLatest.pointsPerUnit);
      if (Number.isFinite(oldRate) && oldRate > 0) {
        const variance = Math.abs(newRate - oldRate) / oldRate;
        if (variance > VARIANCE_THRESHOLD) {
          // 偏差 >5% · 写告警 + 不写 rate · 等 admin 决定
          await recordSystemError(ctx, {
            errorType: 'external',
            errorCode: 'FX_VARIANCE_TOO_LARGE',
            route: '/_internal/fx-auto-sync',
            method: 'CRON',
            message: `${cur.code} 新汇率 ${newRateStr} 跟 DB 现值 ${oldRate} 偏差 ${(variance * 100).toFixed(1)}% · 超 5% 阈值 · admin 在 /admin/exchange-rates 手动审`,
            severity: 60,
            samplePayload: {
              currencyCode: cur.code,
              dbRate: oldRate,
              externalRate: newRate,
              variancePct: +(variance * 100).toFixed(2),
              externalSourceRate: xPerUsd,
              externalUrl: url,
            },
          });
          flagged += 1;
          continue;
        }
        // 偏差 <0.1% · 跳过(无效更新 · 防 history 表噪声)
        if (variance < 0.001) {
          skipped += 1;
          continue;
        }
      }
    }

    // 写 exchange_rates 新一行 · effective_at=now · admin source 用 null
    try {
      await ctx.db.insert(exchangeRates).values({
        currencyCode: cur.code,
        pointsPerUnit: newRateStr,
        effectiveAt: new Date(),
        updatedByUserId: null, // system cron · null = 自动同步
      });
      updated += 1;
    } catch (err) {
      logger.error('fx_auto_sync.insert_failed', { code: cur.code, err: String(err) });
    }
  }

  if (updated > 0) {
    clearFxCache();
  }

  logger.info('fx_auto_sync.tick', { url, updated, flagged, skipped, total: activeList.length });
  return { updated, flagged, skipped };
}

let timer: NodeJS.Timeout | null = null;
export function startFxAutoSyncCron(
  ctx: JobContext,
  intervalMs = 24 * 3600 * 1000, // 每日
): void {
  if (timer) return;
  // 启动延迟 60s · 给主进程 warmup · 避免冷启动多 fetch 阻塞
  setTimeout(() => {
    void runFxAutoSync(ctx).catch((err) => {
      logger.error('fx_auto_sync.bootstrap_failed', { err: String(err) });
    });
  }, 60_000);
  timer = setInterval(() => {
    runFxAutoSync(ctx).catch((err) => {
      logger.error('fx_auto_sync.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}

export function stopFxAutoSyncCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
