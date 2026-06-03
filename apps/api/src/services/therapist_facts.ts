/**
 * M06 · AI 分身「事实边界」数据层
 *
 * 解决的问题：AI 分身替技师跟客户聊天时，对自己不掌握真相、或无权代技师拍板的事实
 * （档期 / 价格 / 项目 / 地点）会凭空承诺——客户问"今晚8点有空吗"，AI 张口就"有呀来吧"，
 * 但技师那个时段可能已满 / 不想接。参照 Moffatt v Air Canada (2024)：部署方须为 AI 的承诺负责，
 * 而本平台零 AI 标识，客户当技师本人金口玉言，越权承诺代价更高。
 *
 * 本模块把技师的真实事实聚合成第一人称口语 block 注入 prompt（grounding），
 * 让分身"看着自己的实情说话"，而不是顺着客户瞎答应。
 *
 * 时区约定（与 availability.ts v1 自洽，务必理解）：
 *   排班钟点存成 UTC 容器里的「墙上时间」——working_hours 的 '20:00' 被拼成 '...T20:00:00Z'，
 *   下单闭环用同一套 slot 比较，自洽。所以 slot.startAt 里的 HH:MM 就是技师眼中的墙上钟点，
 *   **展示时绝不再做时区转换**；时区只用来求「技师本地的今天日期 + 当前钟点」，以过滤已过时段。
 */

import { and, eq, ne, inArray } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { shows, serviceCategories, cities, type Therapist } from '@loverush/db';
import { computeAvailability, type AvailabilitySlot } from './availability';

// ──────────────── 时区映射 ────────────────
// 东南亚主力市场无 DST，按国家映射时区最稳；city slug 作补充；最终兜底平台主力时区。

const COUNTRY_TZ: Record<string, string> = {
  TH: 'Asia/Bangkok',
  MY: 'Asia/Kuala_Lumpur',
  SG: 'Asia/Singapore',
  VN: 'Asia/Ho_Chi_Minh',
  ID: 'Asia/Jakarta',
  PH: 'Asia/Manila',
  KH: 'Asia/Phnom_Penh',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
};

const CITY_TZ: Record<string, string> = {
  bangkok: 'Asia/Bangkok',
  'chiang-mai': 'Asia/Bangkok',
  pattaya: 'Asia/Bangkok',
  phuket: 'Asia/Bangkok',
  singapore: 'Asia/Singapore',
  'kuala-lumpur': 'Asia/Kuala_Lumpur',
  jakarta: 'Asia/Jakarta',
  bali: 'Asia/Makassar',
  'ho-chi-minh': 'Asia/Ho_Chi_Minh',
  hanoi: 'Asia/Ho_Chi_Minh',
};

/** 平台主力市场兜底（曼谷）· 改这里即改默认 */
export const DEFAULT_TZ = 'Asia/Bangkok';

const slug = (s?: string | null): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, '-');

/**
 * 解析技师所在时区 IANA 串（纯函数 · 降级链：city slug → 国家 → city text → 兜底）
 */
export function resolveTz(opts: {
  countryCode?: string | null;
  cityCode?: string | null;
  serviceCountry?: string | null;
  serviceCity?: string | null;
}): string {
  const cityCode = slug(opts.cityCode);
  if (cityCode && CITY_TZ[cityCode]) return CITY_TZ[cityCode];
  const cc = (opts.countryCode ?? opts.serviceCountry ?? '').trim().toUpperCase();
  if (cc && COUNTRY_TZ[cc]) return COUNTRY_TZ[cc];
  const cityText = slug(opts.serviceCity);
  if (cityText && CITY_TZ[cityText]) return CITY_TZ[cityText];
  return DEFAULT_TZ;
}

/**
 * 技师本地「现在」的日期 + 当日已过分钟数（纯函数）
 * 用 Intl 把真实 UTC 时刻转成该时区墙上时间——这是唯一需要时区转换的地方。
 */
export function localNow(tz: string, now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  let hh = parseInt(get('hour'), 10);
  if (hh === 24) hh = 0; // Intl 偶尔把午夜给成 '24'
  const minutes = hh * 60 + parseInt(get('minute'), 10);
  return { date, minutes };
}

/** slot.startAt 的墙上分钟数（直接抽 ISO 的 HH:MM，不做时区转换 · 见文件头约定） */
function slotWallMinutes(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10) : 0;
}

/** date(YYYY-MM-DD) 加 n 天 */
function addDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 分钟数 → 中文墙上时段口语 */
function clockZh(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const mm = m ? `${m}分` : '';
  if (h < 6) return `凌晨${h}点${mm}`;
  if (h < 12) return `早上${h}点${mm}`;
  if (h === 12) return `中午12点${mm}`;
  if (h < 18) return `下午${h - 12}点${mm}`;
  return `晚上${h - 12}点${mm}`;
}

/**
 * 把一天的 slot 列表压成口语段（不逐 slot 列，太碎且费 token）
 * @param minFloorMinutes 今天传本地当前分钟（过滤已过时段）；明天传 0
 * 返回 { text, hasFree } · hasFree=false 表示当天满/无空
 */
export function summarizeDay(
  label: string,
  slots: AvailabilitySlot[],
  minFloorMinutes: number,
): { text: string; hasFree: boolean } {
  if (slots.length === 0) return { text: `${label}没排班、不接单`, hasFree: false };
  const future = slots.filter((s) => slotWallMinutes(s.startAt) >= minFloorMinutes);
  if (future.length === 0) return { text: `${label}已经过点了、没空了`, hasFree: false };
  const avail = future.filter((s) => s.available);
  if (avail.length === 0) return { text: `${label}排满了、没空`, hasFree: false };
  if (avail.length === future.length) return { text: `${label}都有空`, hasFree: true };
  const earliest = Math.min(...avail.map((s) => slotWallMinutes(s.startAt)));
  // 最早可约就在 floor 附近 → "现在起有空"；否则报最早空档钟点
  const text =
    earliest <= minFloorMinutes + 30
      ? `${label}现在起有空`
      : `${label}${clockZh(earliest)}以后有空`;
  return { text, hasFree: true };
}

// ──────────────── 聚合 ────────────────

export interface TherapistFacts {
  /** 档期口语（今天 + 明天）· 无排班数据则空串 */
  availabilityText: string;
  /** 价位口语 · 无则空串 */
  priceText: string;
  /** 服务项目口语 · 无则空串 */
  serviceText: string;
  /** 地点口语 · 无则空串 */
  locationText: string;
  /** 今日是否已满/无空 · 供 checkFactsOverreach 兜底 */
  todayFull: boolean;
}

const CURRENCY_LABEL: Record<string, string> = {
  THB: '泰铢',
  SGD: '新币',
  MYR: '马币',
  IDR: '印尼盾',
  VND: '越南盾',
  CNY: '元',
  USD: '美元',
};

function formatPrice(
  base: Therapist['basePriceJson'],
): string {
  const arr = Array.isArray(base) ? base : [];
  if (arr.length === 0) return '';
  const parts = arr
    .slice(0, 4)
    .map((p) => {
      const cur = p.currencyCode ? (CURRENCY_LABEL[p.currencyCode] ?? p.currencyCode) : '积分';
      const price = p.priceFiat != null ? p.priceFiat : p.pricePoints;
      if (price == null) return null;
      return `${p.duration}分钟 ${price}${cur}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join('、') : '';
}

/**
 * 聚合技师的真实事实（档期/价格/项目/地点）
 * 失败安全：任一子查询异常都不应阻断 AI 回复——调用方应 try/catch，失败退回空 facts。
 */
export async function loadTherapistFacts(
  db: Database,
  t: Therapist,
  now: Date = new Date(),
): Promise<TherapistFacts> {
  // 1. 城市字典（一次查拿到 中文名 + countryCode 供时区）
  let cityName = t.serviceCity ?? '';
  let cityCode: string | null = null;
  let countryCode: string | null = t.serviceCountry ?? null;
  if (t.serviceCityId) {
    const city = await db.query.cities.findFirst({ where: eq(cities.id, t.serviceCityId) });
    if (city) {
      cityCode = city.code;
      countryCode = countryCode ?? city.countryCode;
      cityName = city.translations?.zh ?? city.translations?.en ?? city.code ?? cityName;
    }
  }
  const tz = resolveTz({ countryCode, cityCode, serviceCountry: t.serviceCountry, serviceCity: t.serviceCity });

  // 2. 档期（技师本地今天 + 明天）
  const { date: today, minutes: nowMin } = localNow(tz, now);
  const tomorrow = addDate(today, 1);
  let availabilityText = '';
  let todayFull = false;
  try {
    const [todaySlots, tomSlots] = await Promise.all([
      computeAvailability(db, { therapistUserId: t.userId, date: today }),
      computeAvailability(db, { therapistUserId: t.userId, date: tomorrow }),
    ]);
    const d0 = summarizeDay('今天', todaySlots, nowMin);
    const d1 = summarizeDay('明天', tomSlots, 0);
    todayFull = !d0.hasFree;
    availabilityText = `${d0.text}；${d1.text}`;
  } catch {
    // 档期算不出来就不注入档期（宁可不报也不瞎报）
    availabilityText = '';
  }

  // 3. 价格
  const priceText = formatPrice(t.basePriceJson);

  // 4. 服务项目（distinct 已发布过的 categoryCode → 中文名）
  let serviceText = '';
  try {
    const rows = await db
      .selectDistinct({ code: shows.categoryCode })
      .from(shows)
      .where(and(eq(shows.therapistUserId, t.userId), ne(shows.status, 'draft')));
    const codes = rows.map((r) => r.code).filter(Boolean);
    if (codes.length) {
      const cats = await db.query.serviceCategories.findMany({
        where: inArray(serviceCategories.code, codes),
      });
      const nameByCode = new Map(cats.map((c) => [c.code, c.nameZh]));
      const names = codes.map((c) => nameByCode.get(c) ?? null).filter(Boolean) as string[];
      if (names.length) serviceText = names.join('、');
    }
  } catch {
    serviceText = '';
  }

  // 5. 地点
  const area = t.serviceArea?.trim();
  const locationText = cityName ? (area ? `${cityName} ${area}一带` : `${cityName}`) : '';

  return { availabilityText, priceText, serviceText, locationText, todayFull };
}

/**
 * 把 facts 拼成第一人称口语 block 注入 prompt。无数据的维度整行省略。
 * 全空则返回空串（调用方不注入）。
 */
export function formatFactsBlock(f: TherapistFacts): string {
  const lines: string[] = [];
  if (f.availabilityText) lines.push(`- 你的档期：${f.availabilityText}。`);
  if (f.priceText) lines.push(`- 你的价位：${f.priceText}。`);
  if (f.serviceText) lines.push(`- 你做的项目：${f.serviceText}。`);
  if (f.locationText) lines.push(`- 你在${f.locationText}上门。`);
  if (lines.length === 0) return '';
  return `【你自己掌握的实情】（只有这些是真的；客户问到时间/价位/项目/能不能到某地，只能照这个说，没写的别瞎答应）\n${lines.join('\n')}`;
}

// ──────────────── ④ 窄保险（facts-aware 输出校验）────────────────
// 故意只挡最危险的一种越权：今日已满，却答应客户「今天/今晚」过来。
// 粒度粗、宁缺毋滥——价格/项目/地点的冲突靠 grounding + prompt 兜，不在这里硬拦（易误伤）。

const TODAY_RE = /今天|今晚|今儿|今早|这会儿|这会|马上来|现在来|现在过来/;
const AFFIRM_RE = /有空|可以|没问题|没事儿|行的|行呀|行啊|来吧|来呗|过来吧|等你|约吧|安排|妥了|定了/;
// 否定/婉拒词：出现即说明 AI 在拒今天、推别的时间，不算越权——绝不误毙正确回答
const NEG_RE = /不行|不了|没空|没档|约不了|抽不开|不方便|怕是|可能不|恐怕|改天|下次|明天|明早|后天/;

/**
 * 检测越权时间承诺 · 命中则 caller 应触发重生成
 * 故意只挡最危险一种：今日已满，却肯定答应客户「今天/今晚」过来，且没有任何婉拒/改期措辞。
 * 宁可漏放也不误伤——overreach 命中会毙掉候选，错杀正确回答的代价更高。
 * @returns ok=false 表示该候选越权（今日满却答应今天）
 */
export function checkFactsOverreach(text: string, facts: Pick<TherapistFacts, 'todayFull'>): {
  ok: boolean;
  reason?: string;
} {
  if (!facts.todayFull) return { ok: true };
  if (!TODAY_RE.test(text)) return { ok: true };
  if (NEG_RE.test(text)) return { ok: true }; // 今天明确拒了/推到别的时间 → 不算越权
  if (AFFIRM_RE.test(text)) return { ok: false, reason: 'time_overreach' };
  return { ok: true };
}
