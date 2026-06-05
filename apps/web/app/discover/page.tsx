'use client';

/**
 * 发现 / 筛选页 · 全量重建(真功能)
 *
 * 端点:GET /therapists(真浏览端点 · 服务端筛选)· 替换原 /assistant/recommend
 * 取数:apiGetWithMeta → { data, meta:{ total } } · meta.total 驱动 TOTAL + 分页
 *
 * 三套筛选入口共享同一份 DiscoverFilters state(buildQuery 派生 query):
 *   1) 顶部 chips — 真·多选 toggle(在线/9分/165+/<5000/泰式/油压/SPA 可叠加)
 *   2) 「附近」chip — 真 GPS(navigator.geolocation)· 带 lat/lng/radius_km=3
 *   3) 右上筛选钮 — 完整筛选抽屉(FilterDrawer)· 与 chips 双向同步
 *
 * 搜索框:自由文本 search(名字/关键词)· Enter 触发;城市走抽屉/定位降级。
 *
 * 字段名以 listTherapists/PublicTherapistView 为准:
 *   id / displayName / avatarUrl / serviceCity / onlineStatus
 *   scoreAppearance / scoreBody / scoreService(0-1000 量级)· distance_km(后端新增)
 *   注意:view 没有 rating 字段,评分用 score 三维平均 /300 → 0-10 分。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { prefetchTherapistProps } from '@/lib/prefetch';
import { ArrowLeft, Search, SlidersHorizontal, MapPin, Star, Navigation } from 'lucide-react';
import { apiGetWithMeta, ApiClientError } from '@/lib/api';
import { CustomerBottomNav } from '@/components/BottomNav';
import { useLocationPref } from '@/lib/location';
import { requestCoords } from '@/lib/geolocate';
import {
  FilterDrawer,
  countActiveFilters,
  EMPTY_FILTERS,
  type DiscoverFilters,
} from '@/components/discover/FilterDrawer';

/** /therapists 返回的技师项(字段名严格对齐 PublicTherapistView) */
interface Therapist {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  serviceCity: string | null;
  onlineStatus: string;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  /** 后端「附近」时返回 · 单位 km · 无值为 null */
  distance_km?: number | null;
}

const PAGE_SIZE = 20;
const NEAR_RADIUS_KM = 3;

/** 顶部快捷 chip 定义(toggle 维护到 filters) */
type ChipKey = 'near' | 'online' | 'top' | 'height' | 'price' | 'thai' | 'oil' | 'spa';
const CHIPS: Array<{ key: ChipKey; label: string; sub?: string; dot?: boolean }> = [
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
function isChipActive(key: ChipKey, f: DiscoverFilters): boolean {
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

/** 把 filters + 搜索词 + GPS 坐标 + 分页 派生成 /therapists query */
function buildQuery(
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

export default function DiscoverPage() {
  const [filters, setFilters] = useState<DiscoverFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [list, setList] = useState<Therapist[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  const { pref } = useLocationPref();
  const cityFallback = pref?.cityName ?? pref?.selectedCityName ?? undefined;

  // 防止旧请求覆盖新请求结果(切筛选连点)
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (f: DiscoverFilters, search: string, c: { lat: number; lng: number } | null, offset: number) => {
      const myReq = ++reqIdRef.current;
      const isFirstPage = offset === 0;
      if (isFirstPage) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const query = buildQuery(f, {
          search,
          coords: c,
          cityFallback: cityFallback,
          limit: PAGE_SIZE,
          offset,
        });
        let { data, meta } = await apiGetWithMeta<Therapist[], { total: number }>('/therapists', query);
        if (myReq !== reqIdRef.current) return; // 已有更新的请求 · 丢弃
        // 首屏按城市过滤为空 → 放宽去掉城市再查一次(用户所在城没技师也别给白板,显示全部)
        if (isFirstPage && data.length === 0 && query.city && query.lat === undefined) {
          const wideQuery = { ...query };
          delete wideQuery.city;
          const wide = await apiGetWithMeta<Therapist[], { total: number }>('/therapists', wideQuery);
          if (myReq !== reqIdRef.current) return;
          data = wide.data;
          meta = wide.meta;
          if (data.length > 0) {
            setNotice(`${cityFallback ?? '你'}本地在线的不多 · 先给你看看全部的`);
          }
        }
        setTotal(meta?.total ?? data.length);
        setList((prev) => (isFirstPage ? data : [...prev, ...data]));
      } catch (err) {
        if (myReq !== reqIdRef.current) return;
        if (err instanceof ApiClientError) setError(err.payload.message);
        else setError('加载出错 · 稍后再试');
        if (isFirstPage) setList([]);
      } finally {
        if (myReq === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [cityFallback],
  );

  // 首次加载 + 城市偏好就绪后
  useEffect(() => {
    void load(filters, submittedSearch, coords, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityFallback]);

  // 应用一组新 filters(来自 chips 或抽屉)· 重置到第一页
  function applyFilters(next: DiscoverFilters, c = coords) {
    setFilters(next);
    void load(next, submittedSearch, c, 0);
  }

  // 真 GPS · 取坐标 → 带 lat/lng 请求;失败优雅降级
  // TG Mini App 内走 Telegram LocationManager,普通浏览器走 navigator.geolocation(requestCoords 自动判断)
  async function enableNear() {
    setNotice(null);
    setLocating(true);
    const r = await requestCoords();
    setLocating(false);
    if (r.ok) {
      const c = { lat: r.lat, lng: r.lng };
      setCoords(c);
      setNotice(null);
      applyFilters({ ...filters, near: true }, c);
      return;
    }
    const denied = r.reason === 'denied';
    setNotice(
      denied
        ? cityFallback
          ? `定位被拒绝,已按「${cityFallback}」附近显示。可在筛选里换城市`
          : '定位被拒绝,去筛选里选个城市,或在系统设置里允许定位'
        : cityFallback
          ? `定位失败,已按「${cityFallback}」附近显示`
          : '定位失败,去筛选里选个城市吧',
    );
    // 降级:near 关闭 · 退回城市兜底(绝不静默/卡死)
    applyFilters({ ...filters, near: false });
  }

  // 点顶部快捷 chip · toggle 到 filters
  function onChip(key: ChipKey) {
    if (key === 'near') {
      if (filters.near) {
        // 关闭附近 → 退回普通(城市兜底)
        setNotice(null);
        applyFilters({ ...filters, near: false });
      } else {
        void enableNear();
      }
      return;
    }
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
    }
    applyFilters(f);
  }

  function onSearchSubmit() {
    setSubmittedSearch(searchInput);
    void load(filters, searchInput, coords, 0);
  }

  function loadMore() {
    if (loadingMore || loading) return;
    void load(filters, submittedSearch, coords, list.length);
  }

  const onlineCount = list.filter((t) => t.onlineStatus === 'online').length;
  const hasMore = list.length < total;
  const activeCount = countActiveFilters(filters);

  return (
    <div className="mobile-container relative bg-gradient-soft">
      {/* === Top nav: 搜索框 + 筛选 button === */}
      <nav className="sticky top-0 z-30 flex items-center gap-2 bg-white/85 px-3 py-3 backdrop-blur-md">
        <Link
          href="/home"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-warm-xs">
          <Search className="h-4 w-4 text-ink-300" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
            placeholder="名字 / 关键词"
            className="flex-1 bg-transparent text-[13px] text-ink-800 outline-none placeholder:text-ink-300"
          />
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`relative flex h-9 w-9 items-center justify-center rounded-full shadow-warm-md active:scale-95 ${
            activeCount > 0 ? 'bg-gradient-cta text-white' : 'bg-ink-900 text-white'
          }`}
          title="筛选"
          aria-label="打开筛选"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold text-rose-600 shadow-warm-xs">
              {activeCount}
            </span>
          )}
        </button>
      </nav>

      {/* === Stats strip === */}
      <div className="flex items-center justify-between px-5 py-3 text-[11px] text-ink-700">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="num text-[14px] font-semibold text-ink-900">{onlineCount}</span>
          <span>位 · 在线等你</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-cormorant italic text-[10px] tracking-[0.2em] text-ink-500">TOTAL</span>
          <span className="num text-[14px] font-semibold text-ink-900">{total}</span>
        </span>
      </div>

      {/* === Filter chips sticky · 真·多选 === */}
      <div className="sticky top-[60px] z-20 bg-gradient-soft/95 backdrop-blur-sm">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2">
          {CHIPS.map((f) => {
            const active = isChipActive(f.key, filters);
            const isNear = f.key === 'near';
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onChip(f.key)}
                disabled={isNear && locating}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] transition active:scale-95 disabled:opacity-60 ${
                  active
                    ? 'bg-gradient-cta text-white shadow-warm-sm'
                    : 'bg-white text-ink-700 shadow-warm-xs'
                }`}
              >
                {isNear && (
                  <Navigation
                    className={`h-3 w-3 ${locating ? 'animate-pulse' : ''} ${active ? 'text-white' : 'text-rose-500'}`}
                  />
                )}
                {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-emerald-500'}`} />}
                <span>{isNear && locating ? '定位中…' : f.label}</span>
                {f.sub && <span className="text-[10px] opacity-80">{f.sub}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 降级提示(定位被拒/失败) */}
      {notice && (
        <div className="mx-4 mt-2 rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-[12px] text-warm-700">
          {notice}
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          {error}
        </div>
      )}

      {/*
        动态布局:
        ≤ 3 个 → 单列大卡 + 底部引导;> 3 个 → 标准 2 列网格
      */}
      <section className="px-4 pb-6 pt-2">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-ink-100" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-warm-200 bg-white/60 px-6 py-12 text-center backdrop-blur-sm">
            <div className="text-4xl">🌸</div>
            <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">暂无可用技师</div>
            <div className="mt-1.5 text-[12px] text-ink-500">
              {activeCount > 0 || submittedSearch ? '放宽筛选或换个关键词试试' : '换个城市或稍后再来看看'}
            </div>
            {(activeCount > 0 || submittedSearch || filters.near) && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSubmittedSearch('');
                  setNotice(null);
                  applyFilters(EMPTY_FILTERS);
                }}
                className="mt-4 inline-flex items-center rounded-full bg-gradient-cta px-5 py-2 text-[12.5px] font-medium text-white shadow-rose-md active:scale-95"
              >
                清空筛选
              </button>
            )}
          </div>
        ) : list.length <= 3 ? (
          <>
            <div className="space-y-3">
              {list.map((t, i) => (
                <BigCard key={t.id} t={t} delayMs={Math.min(i * 40, 160)} />
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-dashed border-warm-200 bg-white/50 px-5 py-5 text-center backdrop-blur-sm">
              <div className="text-serif-cn text-[13px] font-medium text-ink-800">就这几位符合</div>
              <div className="mt-1 text-[12px] text-ink-500">放宽筛选或换个城市,会有更多选项</div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {list.map((t, i) => (
                <Card key={t.id} t={t} delayMs={Math.min(i * 30, 240)} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center rounded-full bg-white px-6 py-2.5 text-[13px] font-medium text-ink-700 shadow-warm-sm active:scale-95 disabled:opacity-60"
                >
                  {loadingMore ? '加载中…' : `加载更多 · 还有 ${total - list.length} 位`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <FilterDrawer
        isOpen={drawerOpen}
        initial={filters}
        onClose={() => setDrawerOpen(false)}
        onApply={(next) => applyFilters({ ...next, near: filters.near })}
      />

      <CustomerBottomNav active="discover" />
    </div>
  );
}

/** 三维评分平均 → 0-10 分(view 无 rating 字段,沿用原显示口径) */
function overallScore(t: Therapist): string {
  return ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
}

function DistanceBadge({ t }: { t: Therapist }) {
  if (t.distance_km == null) return null;
  return (
    <span className="flex items-center gap-0.5 text-white/85">
      <Navigation className="h-2.5 w-2.5" />
      {t.distance_km < 1 ? `${Math.round(t.distance_km * 1000)}m` : `${t.distance_km.toFixed(1)}km`}
    </span>
  );
}

function Card({ t, delayMs }: { t: Therapist; delayMs: number }) {
  return (
    <Link
      href={`/therapist/${t.id}`}
      prefetch={true}
      {...prefetchTherapistProps(t.id)}
      className="group block animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-ink-100 shadow-warm-xs">
        {t.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🌸</div>
        )}

        {t.onlineStatus === 'online' && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[9px] font-semibold text-ink-900 backdrop-blur">
            <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-500" />
            在线
          </div>
        )}

        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 backdrop-blur">
          <Star className="h-2.5 w-2.5 fill-warning-500 text-warning-500" />
          <span className="num text-[10px] font-bold text-ink-900">{overallScore(t)}</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
          <div className="text-serif-cn text-[13px] font-semibold text-white drop-shadow">{t.displayName ?? '技师'}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/85">
            {t.serviceCity && (
              <span className="flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5" />
                {t.serviceCity}
              </span>
            )}
            <DistanceBadge t={t} />
          </div>
        </div>
      </div>
    </Link>
  );
}

// 单列大卡 · 用于 ≤ 3 个结果时
function BigCard({ t, delayMs }: { t: Therapist; delayMs: number }) {
  return (
    <Link
      href={`/therapist/${t.id}`}
      prefetch={true}
      {...prefetchTherapistProps(t.id)}
      className="group block animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-ink-100 shadow-warm-sm">
        {t.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl">🌸</div>
        )}

        {t.onlineStatus === 'online' && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-ink-900 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            在线
          </div>
        )}

        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 backdrop-blur">
          <Star className="h-3 w-3 fill-warning-500 text-warning-500" />
          <span className="num text-[11px] font-bold text-ink-900">{overallScore(t)}</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4">
          <div className="text-serif-cn text-[18px] font-semibold text-white drop-shadow">{t.displayName ?? '技师'}</div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-white/90">
            {t.serviceCity && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {t.serviceCity}
              </span>
            )}
            <DistanceBadge t={t} />
          </div>
        </div>
      </div>
    </Link>
  );
}
