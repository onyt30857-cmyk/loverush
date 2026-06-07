/**
 * M17 · Telegram 导航目录(城市分类浏览 + 翻页 + 直达详情)
 *
 * 灰产「导航/索引 bot」的正当版:把现有技师做成结构化可浏览目录。
 *   城市目录 → 点城市 → 技师分页列表 → 点技师 startapp 一跳进 Mini App 详情。
 *
 * 城市来源 = passed 技师的 distinct serviceCity(只展示有供给的城市,且 listTherapists
 * 按 serviceCity 文本过滤天然匹配);callback 用城市索引(无状态可重算,避免把城市名塞进
 * callback_data)。国旗best-effort(serviceCity → cities 字典 → countries 国旗)。
 */

import { and, desc, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { therapists, cities } from '@loverush/db';
import type { Database } from '@loverush/db';
import { listTherapists } from './therapists';
import { priceLabel, scoreLabel, serviceModeLabel, tgConfig } from './telegram';
import { getCountryFlag } from './countries';

const PAGE = 8;

interface Ctx {
  db: Database;
}

interface SupplyCity {
  city: string;
  count: number;
  flag: string;
}

const norm = (s?: string | null): string => (s ?? '').trim().toLowerCase();

/** serviceCity(自由文本) → 国旗(经 cities 字典翻译/code 反查 countryCode → countries 缓存) */
async function buildFlagMap(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ code: cities.code, countryCode: cities.countryCode, translations: cities.translations })
    .from(cities);
  const m = new Map<string, string>(); // normalized name → flag
  for (const r of rows) {
    const flag = getCountryFlag(r.countryCode);
    if (!flag) continue;
    if (r.code) m.set(norm(r.code), flag);
    const tr = (r.translations ?? {}) as Record<string, string>;
    for (const v of Object.values(tr)) if (v) m.set(norm(v), flag);
  }
  return m;
}

/** 有供给的城市(passed 技师 distinct serviceCity + 数量),按数量降序、名称升序稳定排序 */
export async function listSupplyCities(ctx: Ctx): Promise<SupplyCity[]> {
  const rows = await ctx.db
    .select({ city: therapists.serviceCity, n: sql<number>`count(*)::int` })
    .from(therapists)
    .where(and(eq(therapists.verificationStatus, 'passed'), isNotNull(therapists.serviceCity), ne(therapists.serviceCity, '')))
    .groupBy(therapists.serviceCity)
    .orderBy(desc(sql`count(*)`), asc(therapists.serviceCity));
  const flagMap = await buildFlagMap(ctx.db);
  return rows
    .filter((r): r is { city: string; n: number } => !!r.city)
    .map((r) => ({ city: r.city, count: r.n, flag: flagMap.get(norm(r.city)) ?? '' }));
}

// ──────────────── callback_data 解析 ────────────────

export type DirNav =
  | { type: 'root' }
  | { type: 'city'; idx: number; page: number };

/** `root` / `c:<idx>:<page>` → 结构;非法返回 null */
export function parseCallback(data?: string): DirNav | null {
  if (!data) return null;
  if (data === 'root') return { type: 'root' };
  const m = /^c:(\d+):(\d+)$/.exec(data);
  if (m) return { type: 'city', idx: Number(m[1]), page: Number(m[2]) };
  return null;
}

// ──────────────── 菜单构建(返回 {text, reply_markup}) ────────────────

export interface TgMenu {
  text: string;
  reply_markup: { inline_keyboard: Array<Array<Record<string, unknown>>> };
}

/** 城市目录:每城一按钮 `🇹🇭 曼谷 (12)`,callback c:<idx>:0 · 两列排布 */
export async function buildCityMenu(ctx: Ctx): Promise<TgMenu> {
  const list = await listSupplyCities(ctx);
  if (list.length === 0) {
    return { text: '暂时还没有可浏览的城市，去 App 里看看吧～', reply_markup: { inline_keyboard: [] } };
  }
  const buttons = list.map((c, idx) => ({
    text: `${c.flag ? c.flag + ' ' : ''}${c.city} (${c.count})`,
    callback_data: `c:${idx}:0`,
  }));
  // 两列
  const rows: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { text: '选个城市看看 👇', reply_markup: { inline_keyboard: rows } };
}

/** 某城市技师分页列表:每行 URL 按钮 startapp 直达详情 + 底部翻页/返回 */
export async function buildTherapistList(ctx: Ctx, idx: number, page: number): Promise<TgMenu> {
  const list = await listSupplyCities(ctx);
  const target = list[idx];
  if (!target) return buildCityMenu(ctx); // 索引漂移(城市变动)→ 回城市目录
  const { botUsername } = tgConfig();
  const safePage = Math.max(0, page);
  const offset = safePage * PAGE;
  const { data } = await listTherapists(ctx, { city: target.city, limit: PAGE, offset });
  const totalPages = Math.max(1, Math.ceil(target.count / PAGE));

  const rows: Array<Array<Record<string, unknown>>> = [];
  for (const t of data) {
    const price = priceLabel(t.basePriceJson);
    const mode = serviceModeLabel(t.serviceMode);
    const parts = [t.displayName ?? '技师', mode, price, `★${scoreLabel(t)}`].filter(Boolean);
    let label = parts.join(' · ');
    if (label.length > 40) label = label.slice(0, 39) + '…';
    // inline 按钮不允许 web_app;用 startapp URL 按钮一跳进 Mini App 详情
    if (botUsername) {
      rows.push([{ text: label, url: `https://t.me/${botUsername}?startapp=t_${t.id}` }]);
    } else {
      rows.push([{ text: label, callback_data: 'root' }]); // 无 botUsername 退化(prod 不会到)
    }
  }

  // 翻页 + 返回行
  const nav: Array<Record<string, unknown>> = [];
  if (safePage > 0) nav.push({ text: '⬅️ 上一页', callback_data: `c:${idx}:${safePage - 1}` });
  nav.push({ text: '🔙 城市', callback_data: 'root' });
  if (safePage < totalPages - 1) nav.push({ text: '下一页 ➡️', callback_data: `c:${idx}:${safePage + 1}` });
  rows.push(nav);

  const head = `${target.flag ? target.flag + ' ' : ''}${target.city} · 第 ${safePage + 1}/${totalPages} 页`;
  const text = data.length === 0 ? `${head}\n这一页空了，返回看看其他～` : `${head}\n点技师卡直接进详情 👇`;
  return { text, reply_markup: { inline_keyboard: rows } };
}
