/**
 * 位置选择 BottomSheet · v4 三级手风琴 (2026-06-09)
 *
 * Tony 反馈"全部展开要一直往下滑,体验不好" → 改三级就地展开手风琴:
 *  - 一级:国家列表(默认全折叠,只看国家)
 *  - 点国家 → 就地展开该国城市(其余国家保持折叠)
 *  - 点城市 → 就地展开区域(全城范围 + 细分区域),点区域/全城即选定
 * 同时只展开一个国家、一个城市,层级清晰、不用滑很久。
 * 搜索时切到扁平匹配城市列表(点城市仍可就地展开区域)。
 *
 * 保留 v3:顶部搜索、当前位置 hero、技师数 pill、空态、isEmpty 禁用。
 * 数据源:GET /geo/countries · /geo/cities · /geo/cities/:id/areas
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import { useCities, useAreas, useCountries, useLocationPref, type GeoCity, type GeoArea } from '@/lib/location';

interface Props {
  isOpen: boolean;
  currentCityId: string | null;
  currentAreaId: string | null;
  onClose: () => void;
  onSelect: (args: { cityId: string; areaId: string | null }) => void;
}

export function LocationSheet({ isOpen, currentCityId, currentAreaId, onClose, onSelect }: Props) {
  const { cities } = useCities();
  const { countries } = useCountries();
  const { pref } = useLocationPref();
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const [expandedCity, setExpandedCity] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { areas } = useAreas(expandedCity);

  useEffect(() => {
    if (!isOpen) return;
    setExpandedCountry(null);
    setExpandedCity(null);
    setSearch('');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  function pickCity(cityId: string) {
    // 切换城市展开 → 区域;同城市再点则收起
    setExpandedCity((prev) => (prev === cityId ? null : cityId));
  }
  function pickCountry(country: string) {
    setExpandedCountry((prev) => (prev === country ? null : country));
    setExpandedCity(null); // 切国家时收起已展开的城市
  }
  function selectArea(cityId: string, areaId: string | null) {
    onSelect({ cityId, areaId });
    onClose();
  }

  if (!isOpen) return null;

  const trimmed = search.trim().toLowerCase();
  const currentLocationLabel = pref?.cityName
    ? `${pref.cityName}${pref.areaName ? ' · ' + pref.areaName : ''}`
    : null;
  const currentCountryMeta = pref?.lastCountryCode
    ? countries.find((c) => c.country === pref.lastCountryCode)
    : null;
  const currentCityTherapistCount = pref?.inDictionary
    ? cities.find((c) => c.id === currentCityId)?.therapistCount ?? null
    : null;

  // 搜索过滤匹配城市(匹配 city.name 或 country label)
  const matchedCities = useMemo(() => {
    if (!trimmed) return [];
    return cities.filter((c) => {
      if (c.name.toLowerCase().includes(trimmed)) return true;
      const co = countries.find((co) => co.country === c.country);
      return co?.label.toLowerCase().includes(trimmed) ?? false;
    });
  }, [cities, countries, trimmed]);

  // 城市按国家分组(无搜索时)
  const byCountry = useMemo(() => {
    const m = new Map<string, GeoCity[]>();
    for (const c of cities) {
      if (!m.has(c.country)) m.set(c.country, []);
      m.get(c.country)!.push(c);
    }
    return m;
  }, [cities]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-label="关闭" />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 mx-auto max-w-[390px] flex max-h-[90vh] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
      >
        {/* ─── 顶部 sticky · 拖把 + 标题 + 搜索 ─── */}
        <div className="shrink-0 bg-white">
          <div className="mx-auto mt-2.5 h-1 w-12 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between px-5 pt-3 pb-1">
            <h2 className="font-serif-cn text-[18px] font-semibold tracking-tight text-ink-900">选择位置</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-5 pb-3 pt-2">
            <div className="flex items-center gap-2.5 rounded-2xl bg-ink-50 px-4 py-3 transition focus-within:bg-white focus-within:shadow-warm-sm focus-within:ring-2 focus-within:ring-primary/25">
              <Search className="h-[18px] w-[18px] shrink-0 text-ink-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索城市 / 国家"
                className="flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="清空"
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-200 text-white active:bg-ink-400"
                >
                  <X className="h-3 w-3" strokeWidth={3} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ─── 主体 · 可滚 ─── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-1">
          {/* 当前位置 hero(仅无搜索) */}
          {!trimmed && currentLocationLabel && (
            <section className="mb-6">
              <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                当前位置
              </h3>
              <div className="relative overflow-hidden rounded-2xl bg-white p-4 ring-1 ring-primary/20 shadow-[0_4px_20px_rgba(255,87,119,0.12)]">
                <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-cta opacity-10" />
                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-cta text-white shadow-rose-md">
                      <MapPin className="h-5 w-5" strokeWidth={2.4} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-serif-cn text-[16px] font-semibold text-ink-900">{currentLocationLabel}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-500">
                        {currentCountryMeta?.flag && <span className="text-[15px] leading-none">{currentCountryMeta.flag}</span>}
                        <span>{currentCountryMeta?.label}</span>
                        {typeof currentCityTherapistCount === 'number' && (
                          <>
                            <span className="text-ink-300">·</span>
                            <span className="num font-semibold text-warm-700">{currentCityTherapistCount}</span>
                            <span className="-ml-0.5">位</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} />
                </div>
              </div>
            </section>
          )}

          {/* ── 搜索结果:扁平匹配城市(可就地展开区域) ── */}
          {trimmed && (
            matchedCities.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-warm-200 bg-warm-50/50 p-8 text-center">
                <Search className="mx-auto h-8 w-8 text-warm-300" strokeWidth={1.5} />
                <div className="mt-2 font-serif-cn text-[14px] font-medium text-ink-700">没找到「{search}」</div>
                <div className="mt-1 text-[12px] text-ink-500">换个关键词试试</div>
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl bg-white ring-1 ring-warm-100">
                {matchedCities.map((c, idx) => (
                  <CityRow
                    key={c.id}
                    city={c}
                    flag={countries.find((co) => co.country === c.country)?.flag}
                    isFirst={idx === 0}
                    isCurrent={c.id === currentCityId}
                    expanded={expandedCity === c.id}
                    areas={expandedCity === c.id ? areas : []}
                    currentAreaId={currentAreaId}
                    onToggle={() => pickCity(c.id)}
                    onSelectArea={(areaId) => selectArea(c.id, areaId)}
                  />
                ))}
              </ul>
            )
          )}

          {/* ── 国家三级手风琴(无搜索) ── */}
          {!trimmed && (
            <section className="space-y-3">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {currentLocationLabel ? '切换其他地区' : '选择地区'}
              </h3>
              {countries.map((co) => {
                const list = byCountry.get(co.country) ?? [];
                if (list.length === 0) return null;
                const total = list.reduce((s, x) => s + x.therapistCount, 0);
                const open = expandedCountry === co.country;
                return (
                  <div key={co.country} className="overflow-hidden rounded-2xl bg-white ring-1 ring-warm-100">
                    {/* 国家行(可折叠) */}
                    <button
                      type="button"
                      onClick={() => pickCountry(co.country)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition active:bg-warm-50/70"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-[22px] leading-none">{co.flag}</span>
                        <span className="font-serif-cn text-[15px] font-semibold text-ink-900">{co.label}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-0.5 text-[11px] text-warm-700">
                          <span className="num font-bold">{total}</span>
                          <span className="text-warm-600">位</span>
                        </span>
                        <ChevronDown
                          className={`h-4.5 w-4.5 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
                          strokeWidth={2.2}
                        />
                      </div>
                    </button>

                    {/* 城市列表(国家展开时) */}
                    {open && (
                      <ul className="border-t border-warm-50 bg-warm-50/30">
                        {list.map((c) => (
                          <CityRow
                            key={c.id}
                            city={c}
                            isFirst={false}
                            indent
                            isCurrent={c.id === currentCityId}
                            expanded={expandedCity === c.id}
                            areas={expandedCity === c.id ? areas : []}
                            currentAreaId={currentAreaId}
                            onToggle={() => pickCity(c.id)}
                            onSelectArea={(areaId) => selectArea(c.id, areaId)}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ──────────────── 城市行(可就地展开区域) ────────────────

function CityRow({
  city,
  flag,
  isFirst,
  indent,
  isCurrent,
  expanded,
  areas,
  currentAreaId,
  onToggle,
  onSelectArea,
}: {
  city: GeoCity;
  flag?: string;
  isFirst: boolean;
  indent?: boolean;
  isCurrent: boolean;
  expanded: boolean;
  areas: GeoArea[];
  currentAreaId: string | null;
  onToggle: () => void;
  onSelectArea: (areaId: string | null) => void;
}) {
  const isEmpty = city.therapistCount === 0;
  return (
    <li className={isFirst ? '' : 'border-t border-warm-50'}>
      <button
        type="button"
        onClick={() => !isEmpty && onToggle()}
        disabled={isEmpty}
        className={`flex w-full items-center justify-between gap-3 py-3.5 text-left transition active:bg-warm-50/70 ${
          indent ? 'pl-6 pr-4' : 'px-4'
        } ${isEmpty ? 'cursor-not-allowed opacity-50' : ''} ${
          isCurrent ? 'bg-gradient-to-r from-primary/[0.04] to-transparent' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {flag ? (
            <span className="text-[16px] leading-none">{flag}</span>
          ) : (
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                isCurrent ? 'bg-primary' : isEmpty ? 'bg-ink-200' : 'bg-warm-300'
              }`}
            />
          )}
          <span
            className={`truncate text-[14.5px] ${
              isCurrent ? 'font-semibold text-primary' : isEmpty ? 'text-ink-500' : 'font-medium text-ink-900'
            }`}
          >
            {city.name}
          </span>
          {isCurrent && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">已选</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isEmpty ? (
            <span className="text-[12px] text-ink-400">暂未开通</span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-1 text-[12px]">
              <span className="num font-bold text-warm-700">{city.therapistCount}</span>
              <span className="text-warm-600">位</span>
            </span>
          )}
          {!isEmpty && (
            <ChevronDown className={`h-4 w-4 text-ink-400 transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={2.2} />
          )}
        </div>
      </button>

      {/* 区域(城市展开时):全城范围 + 细分区域 */}
      {expanded && !isEmpty && (
        <div className="bg-white px-4 pb-3 pt-1">
          <button
            type="button"
            onClick={() => onSelectArea(null)}
            className={`mb-1.5 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left ring-1 transition active:bg-warm-50/70 ${
              currentAreaId === null && isCurrent
                ? 'bg-gradient-to-r from-primary/[0.06] to-transparent ring-primary/25'
                : 'bg-white ring-warm-100'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-[15px]">🌐</span>
              <span className="text-[13.5px] font-medium text-ink-900">全城范围</span>
              <span className="text-[11px] text-ink-400">不限区域</span>
            </span>
            {currentAreaId === null && isCurrent && <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />}
          </button>
          {areas.length > 0 ? (
            <ul className="space-y-1">
              {areas.map((a) => {
                const aEmpty = a.therapistCount === 0;
                const aCurrent = a.id === currentAreaId && isCurrent;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => !aEmpty && onSelectArea(a.id)}
                      disabled={aEmpty}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition active:bg-warm-50/70 ${
                        aEmpty ? 'cursor-not-allowed opacity-50' : ''
                      } ${aCurrent ? 'bg-primary/[0.05]' : ''}`}
                    >
                      <span className={`text-[13.5px] ${aCurrent ? 'font-semibold text-primary' : 'text-ink-800'}`}>{a.name}</span>
                      <span className="flex items-center gap-2">
                        {aEmpty ? (
                          <span className="text-[11px] text-ink-400">暂未开通</span>
                        ) : (
                          <span className="num text-[12px] font-bold text-warm-700">{a.therapistCount}位</span>
                        )}
                        {aCurrent && <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-1 py-1 text-[12px] text-ink-400">该城市无细分区域,点「全城范围」即可</div>
          )}
        </div>
      )}
    </li>
  );
}
