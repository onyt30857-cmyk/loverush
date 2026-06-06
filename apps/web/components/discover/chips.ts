/**
 * 发现/首页 共享筛选 chip 逻辑(纯函数 · 无 React)
 *
 * discover 页与 home 页共用同一套快捷 chip 定义 + 高亮判定 + query 派生,
 * 保证两处筛选「视觉 + 行为」完全一致。state 模型沿用 DiscoverFilters(FilterDrawer)。
 */
import type { DiscoverFilters } from './FilterDrawer';

export const NEAR_RADIUS_KM = 3;

/** 顶部快捷 chip 定义(toggle 维护到 DiscoverFilters) */
export type ChipKey = 'near' | 'online' | 'top' | 'height' | 'price' | 'thai' | 'oil' | 'spa';

export const CHIPS: Array<{ key: ChipKey; label: string; sub?: string; dot?: boolean }> = [
  { key: 'near', label: '附近', sub: `${NEAR_RADIUS_KM}km` },
  { key: 'online', label: '在线', dot: true },
  { key: 'top', label: '9 分天花板' },
  { key: 'height', label: '165cm+' },
  { key: 'price', label: '< 5000 pts' },
  { key: 'thai', label: '泰式' },
  { key: 'oil', label: '油压' },
  { key: 'spa', label: 'SPA' },
];

/** 某个快捷 chip 在当前 filters 下是否高亮 */
export function isChipActive(key: ChipKey, f: DiscoverFilters): boolean {
  switch (key) {
    case 'near':
      return !!f.near;
    case 'online':
      return !!f.online;
    case 'top':
      return f.minRating === 9;
    case 'height':
      return f.heightMin === 165;
    case 'price':
      return f.priceMax === 5000;
    case 'thai':
      return f.skills.includes('泰式');
    case 'oil':
      return f.skills.includes('油压');
    case 'spa':
      return f.skills.includes('SPA');
  }
}

/** 点一个快捷 chip · 返回 toggle 后的新 filters(near 由调用方单独处理 GPS,不在此切) */
export function toggleChip(key: ChipKey, filters: DiscoverFilters): DiscoverFilters {
  const f = { ...filters };
  switch (key) {
    case 'online':
      f.online = f.online ? undefined : true;
      break;
    case 'top':
      f.minRating = f.minRating === 9 ? undefined : 9;
      break;
    case 'height':
      f.heightMin = f.heightMin === 165 ? undefined : 165;
      break;
    case 'price':
      f.priceMax = f.priceMax === 5000 ? undefined : 5000;
      break;
    case 'thai':
    case 'oil':
    case 'spa': {
      const skill = key === 'thai' ? '泰式' : key === 'oil' ? '油压' : 'SPA';
      f.skills = f.skills.includes(skill) ? f.skills.filter((s) => s !== skill) : [...f.skills, skill];
      break;
    }
    case 'near':
      // near 由 page 端 GPS 流程处理,这里不动
      break;
  }
  return f;
}

/** 把 filters + 搜索词 + GPS 坐标 + 分页 派生成 /therapists query */
export function buildQuery(
  f: DiscoverFilters,
  opts: {
    search?: string;
    coords?: { lat: number; lng: number } | null;
    cityFallback?: string;
    limit: number;
    offset: number;
  },
): Record<string, string | number | boolean | undefined> {
  const q: Record<string, string | number | boolean | undefined> = {
    limit: opts.limit,
    offset: opts.offset,
  };
  if (opts.search && opts.search.trim()) q.search = opts.search.trim();
  if (f.online) q.online = 'true';
  if (typeof f.minRating === 'number') q.min_rating = f.minRating;
  if (typeof f.heightMin === 'number') q.height_min = f.heightMin;
  if (typeof f.heightMax === 'number') q.height_max = f.heightMax;
  if (typeof f.priceMax === 'number') q.price_max = f.priceMax;
  if (f.nationality) q.nationality = f.nationality;
  if (f.language) q.language = f.language;
  // 后端 skill 支持逗号多选 = 命中任一技能(OR)
  if (f.skills.length > 0) q.skill = f.skills.join(',');

  if (f.near && opts.coords) {
    // 真 GPS · 后端按距离过滤 + 升序
    q.lat = opts.coords.lat;
    q.lng = opts.coords.lng;
    q.radius_km = NEAR_RADIUS_KM;
  } else if (opts.cityFallback) {
    // 非附近 · 用城市偏好兜底(若有)
    q.city = opts.cityFallback;
  }
  return q;
}

/** query 对象 → URLSearchParams 字符串(丢 undefined)· SWR 动态 key 用 */
export function queryToString(q: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
}
