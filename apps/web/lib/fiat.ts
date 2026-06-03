/**
 * 0027 法币显示 util · 客户端统一格式化
 *
 * 用法:
 *   pointsToFiatLabel(50, 'THB', currencies)
 *   → '฿17' (若 1 ฿ = 3 积分)
 *
 * 兜底:无 currency 字典 / 无 rate → 显原积分 "50 积分"
 */

export interface CurrencyMini {
  code: string;
  symbol: string;
  decimals: number;
  pointsPerUnit?: string | null; // numeric string from /currencies
}

/** 拿币种对象 · 容错 null */
export function findCurrency(
  code: string | null | undefined,
  list: CurrencyMini[],
): CurrencyMini | undefined {
  if (!code) return undefined;
  return list.find((c) => c.code === code);
}

/** 格式化法币 · 按 decimals · '฿1,500' */
export function formatFiat(amount: number, currency: CurrencyMini | undefined): string {
  if (!currency) return amount.toString();
  return `${currency.symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}

/**
 * 积分 → 法币显示文本
 *
 * @param points 积分
 * @param currencyCode 技师默认法币 code(可 null · 没设走 fallback)
 * @param currencies 客户端拉的字典(/currencies)
 * @param opts.showPointsHint true 时附带" (50 积分)"
 * @returns "฿17" 或 fallback "50 积分"
 */
export function pointsToFiatLabel(
  points: number,
  currencyCode: string | null | undefined,
  currencies: CurrencyMini[],
  opts: { showPointsHint?: boolean } = {},
): string {
  const cur = findCurrency(currencyCode, currencies);
  if (!cur || !cur.pointsPerUnit) return `${points.toLocaleString()} 积分`;
  const rate = parseFloat(cur.pointsPerUnit);
  if (!Number.isFinite(rate) || rate <= 0) return `${points.toLocaleString()} 积分`;
  const fiat = points / rate;
  // 按 currency.decimals 四舍五入到合适位
  const fiatRounded = Number(fiat.toFixed(cur.decimals));
  const main = formatFiat(fiatRounded, cur);
  if (opts.showPointsHint) {
    return `${main} (${points.toLocaleString()} 积分)`;
  }
  return main;
}

/**
 * 直接显法币 · 已有 fiat 数值时用
 */
export function fiatLabel(
  amount: number,
  currencyCode: string | null | undefined,
  currencies: CurrencyMini[],
): string {
  const cur = findCurrency(currencyCode, currencies);
  return formatFiat(amount, cur);
}
