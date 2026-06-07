/**
 * 国家字典读模型 · 单一事实源的进程内缓存
 *
 * countries / cities.timezone / 已配汇率币种 三份数据缓存在内存(TTL 5min · 仿 fx.ts)。
 * 提供同步读取器给 resolveTz / deriveDefaultCurrency(它们是同步纯函数,不能 await)。
 * 缓存未热或表缺数据时返回 undefined → 调用方回退硬编码兜底,零行为破坏。
 *
 * 写路径(后台增删国家/城市)调 clearCountryCache() 立即失效;多实例靠 TTL 自愈。
 */

import { getDb } from '../db';
import { countries as countriesTbl, cities, exchangeRates } from '@loverush/db';

export interface CountryLite {
  code: string;
  nameZh: string;
  nameEn: string;
  flagEmoji: string | null;
  timezone: string;
  defaultCurrency: string;
  dialCode: string | null;
  enabled: number;
  sortOrder: number;
}

interface Snapshot {
  countryByCode: Map<string, CountryLite>;
  cityTzByCode: Map<string, string>;       // city slug → timezone(仅有覆盖的)
  cityCountryById: Map<string, string>;    // cityId → countryCode
  cityCountryByCode: Map<string, string>;  // city slug → countryCode
  rateBacked: Set<string>;                 // 已配 exchange_rate 的币种
  loadedAt: number;
}

let snap: Snapshot | null = null;
let loading: Promise<void> | null = null;
const TTL_MS = 300_000;

const slug = (s?: string | null): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, '-');

/**
 * 国家名/ISO 归一化 → ISO alpha-2(大写)· 单一来源(原散落在 therapists.ts)
 * 兼容中文名 / 英文名 / ISO 码三种写法(历史 serviceCountry text 散落)。
 */
const NAME_TO_ISO: Record<string, string> = {
  泰国: 'TH', thailand: 'TH', thai: 'TH', th: 'TH',
  越南: 'VN', vietnam: 'VN', vn: 'VN',
  新加坡: 'SG', singapore: 'SG', sg: 'SG',
  马来西亚: 'MY', malaysia: 'MY', my: 'MY',
  印尼: 'ID', 印度尼西亚: 'ID', indonesia: 'ID', id: 'ID',
  菲律宾: 'PH', philippines: 'PH', ph: 'PH',
  柬埔寨: 'KH', cambodia: 'KH', kh: 'KH',
  中国: 'CN', china: 'CN', cn: 'CN',
  中国香港: 'HK', 香港: 'HK', 'hong kong': 'HK', hongkong: 'HK', hk: 'HK',
  中国台湾: 'TW', 台湾: 'TW', taiwan: 'TW', tw: 'TW',
  日本: 'JP', japan: 'JP', jp: 'JP',
  韩国: 'KR', 'south korea': 'KR', korea: 'KR', kr: 'KR',
  美国: 'US', usa: 'US', 'united states': 'US', us: 'US',
};

/** 国家名/ISO → 规范 ISO alpha-2(大写);无法识别时回退原值大写;空→undefined */
export function normalizeCountryCode(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  return (NAME_TO_ISO[t] ?? NAME_TO_ISO[t.toLowerCase()] ?? t).toUpperCase();
}

/** 从 DB 重建快照(显式调用 = 启动预热 / 测试) */
export async function refreshCountryCache(): Promise<void> {
  const db = getDb();
  const [cs, cityRows, rateRows] = await Promise.all([
    db.select().from(countriesTbl),
    db
      .select({
        id: cities.id,
        code: cities.code,
        countryCode: cities.countryCode,
        timezone: cities.timezone,
      })
      .from(cities),
    db.select({ code: exchangeRates.currencyCode }).from(exchangeRates),
  ]);

  const countryByCode = new Map<string, CountryLite>();
  for (const r of cs) {
    countryByCode.set(r.code.toUpperCase(), {
      code: r.code.toUpperCase(),
      nameZh: r.nameZh,
      nameEn: r.nameEn,
      flagEmoji: r.flagEmoji,
      timezone: r.timezone,
      defaultCurrency: r.defaultCurrency,
      dialCode: r.dialCode,
      enabled: r.enabled,
      sortOrder: r.sortOrder,
    });
  }

  const cityTzByCode = new Map<string, string>();
  const cityCountryById = new Map<string, string>();
  const cityCountryByCode = new Map<string, string>();
  for (const r of cityRows) {
    const cc = (r.countryCode ?? '').toUpperCase();
    if (r.id && cc) cityCountryById.set(r.id, cc);
    const cslug = slug(r.code);
    if (cslug && cc) cityCountryByCode.set(cslug, cc);
    if (cslug && r.timezone) cityTzByCode.set(cslug, r.timezone);
  }

  const rateBacked = new Set<string>();
  for (const r of rateRows) if (r.code) rateBacked.add(r.code);

  snap = {
    countryByCode,
    cityTzByCode,
    cityCountryById,
    cityCountryByCode,
    rateBacked,
    loadedAt: Date.now(),
  };
}

/** 同步调用 · 缓存缺失或过期时后台异步重建(不阻塞) */
function ensureFresh(): void {
  if (snap && Date.now() - snap.loadedAt <= TTL_MS) return;
  if (!loading) {
    loading = refreshCountryCache()
      .catch(() => {
        /* DB 抖动忽略 · 下次再试 · 期间走兜底 */
      })
      .finally(() => {
        loading = null;
      });
  }
}

/** 后台改国家/城市/汇率后立即失效 */
export function clearCountryCache(): void {
  snap = null;
  ensureFresh();
}

// ──────────────── 同步读取器(给 resolveTz / deriveDefaultCurrency)────────────────

export function getCountryTz(code?: string | null): string | undefined {
  ensureFresh();
  if (!code) return undefined;
  return snap?.countryByCode.get(code.trim().toUpperCase())?.timezone;
}

export function getCountryCurrency(code?: string | null): string | undefined {
  ensureFresh();
  if (!code) return undefined;
  return snap?.countryByCode.get(code.trim().toUpperCase())?.defaultCurrency;
}

export function getCountryFlag(code?: string | null): string | undefined {
  ensureFresh();
  if (!code) return undefined;
  return snap?.countryByCode.get(code.trim().toUpperCase())?.flagEmoji ?? undefined;
}

export function getCityTz(citySlugOrCode?: string | null): string | undefined {
  ensureFresh();
  const s = slug(citySlugOrCode);
  return s ? snap?.cityTzByCode.get(s) : undefined;
}

export function getCityCountryById(cityId?: string | null): string | undefined {
  ensureFresh();
  return cityId ? snap?.cityCountryById.get(cityId) : undefined;
}

export function getCityCountryByCode(citySlug?: string | null): string | undefined {
  ensureFresh();
  const s = slug(citySlug);
  return s ? snap?.cityCountryByCode.get(s) : undefined;
}

/** 该币种是否已配汇率(无则下单回退积分模式,防 getLatestRate throw) */
export function isRateBacked(currency?: string | null): boolean {
  ensureFresh();
  if (!currency) return false;
  return snap?.rateBacked.has(currency) ?? false;
}
