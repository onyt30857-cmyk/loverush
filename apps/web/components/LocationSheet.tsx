/**
 * 位置选择 BottomSheet · v3 升级 (2026-06-01)
 *
 * Tony 反馈"不高级 · 不能搜索 · 重新升级 品质精美"
 * 调研标杆: Airbnb 地点选择 + Booking 国家分层 + 滴滴技师数 pill
 *
 * 升级点:
 *  - 顶部 sticky 大字标题 + 搜索 input (即时过滤 city/country)
 *  - 当前位置 hero 卡 · 玫瑰渐变描边 + glow ring
 *  - 国家分组 header · 大国旗 + 国家名 + 技师总数 pill
 *  - 城市行 · 加大 padding + 圆点 leading + 技师数 chip (右靠齐)
 *  - 整体配色 · 移除杂底 warm-50 · 改纯白 + 暖色 hairline 描边
 *  - 字号 · 头部 18 / 城市 14.5 / 技师数 13 num-display
 *  - 阴影 · 整 sheet 顶部 -12px 大柔阴影 · 卡内 shadow-warm-xs
 *
 * 数据源 (复用 v2):
 *   GET /geo/countries
 *   GET /geo/cities
 *   GET /geo/cities/:id/areas
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, MapPin, Search, X } from 'lucide-react';
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
  const [drillCityId, setDrillCityId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { areas } = useAreas(drillCityId);

  useEffect(() => {
    if (!isOpen) return;
    setDrillCityId(null);
    setSearch('');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-label="关闭" />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
      >
        {/* ─── 顶部 sticky · 拖把 + 标题 + 搜索 ─── */}
        <div className="shrink-0 bg-white">
          <div className="mx-auto mt-2.5 h-1 w-12 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between px-5 pt-3 pb-1">
            {drillCityId ? (
              <button
                type="button"
                onClick={() => setDrillCityId(null)}
                className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-full active:bg-ink-50"
                aria-label="返回"
              >
                <ArrowLeft className="h-5 w-5 text-ink-700" />
              </button>
            ) : (
              <h2 className="font-serif-cn text-[18px] font-semibold tracking-tight text-ink-900">
                选择位置
              </h2>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* 搜索框 · 只主列表显 */}
          {!drillCityId && (
            <div className="px-5 pb-3 pt-2">
              <div className="flex items-center gap-2.5 rounded-2xl bg-ink-50 px-4 py-3 transition focus-within:bg-white focus-within:shadow-warm-sm focus-within:ring-2 focus-within:ring-primary/25">
                <Search className="h-[18px] w-[18px] shrink-0 text-ink-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索城市 / 国家"
                  autoFocus={false}
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
          )}
        </div>

        {/* ─── 主体 · 可滚 ─── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!drillCityId && (
            <CityBrowser
              cities={cities}
              countries={countries}
              currentCityId={currentCityId}
              currentLocationLabel={
                pref?.cityName ? `${pref.cityName}${pref.areaName ? ' · ' + pref.areaName : ''}` : null
              }
              currentCountryFromCity={cities.find((c) => c.id === currentCityId)?.country ?? null}
              currentCityTherapistCount={cities.find((c) => c.id === currentCityId)?.therapistCount ?? null}
              search={search}
              onPickCity={(city) => setDrillCityId(city.id)}
            />
          )}
          {drillCityId && (
            <AreaBrowser
              areas={areas}
              currentAreaId={currentAreaId}
              cityName={cities.find((c) => c.id === drillCityId)?.name ?? ''}
              cityTherapistCount={cities.find((c) => c.id === drillCityId)?.therapistCount ?? 0}
              onSelectAll={() => {
                onSelect({ cityId: drillCityId, areaId: null });
                onClose();
              }}
              onSelectArea={(a) => {
                onSelect({ cityId: drillCityId, areaId: a.id });
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ──────────────────── 主列表:当前位置 hero + 国家分组 + 搜索过滤 ────────────────────

function CityBrowser({
  cities,
  countries,
  currentCityId,
  currentLocationLabel,
  currentCountryFromCity,
  currentCityTherapistCount,
  search,
  onPickCity,
}: {
  cities: GeoCity[];
  countries: ReturnType<typeof useCountries>['countries'];
  currentCityId: string | null;
  currentLocationLabel: string | null;
  currentCountryFromCity: string | null;
  currentCityTherapistCount: number | null;
  search: string;
  onPickCity: (c: GeoCity) => void;
}) {
  const trimmed = search.trim().toLowerCase();
  const currentCountryMeta = currentCountryFromCity
    ? countries.find((c) => c.country === currentCountryFromCity)
    : null;

  // 搜索过滤: 匹配 city.name 或 country label
  const filtered = useMemo(() => {
    if (!trimmed) return cities;
    return cities.filter((c) => {
      if (c.name.toLowerCase().includes(trimmed)) return true;
      const co = countries.find((co) => co.country === c.country);
      if (co?.label.toLowerCase().includes(trimmed)) return true;
      return false;
    });
  }, [cities, countries, trimmed]);

  // 按 country 分组
  const byCountry = useMemo(() => {
    const m = new Map<string, GeoCity[]>();
    for (const c of filtered) {
      if (!m.has(c.country)) m.set(c.country, []);
      m.get(c.country)!.push(c);
    }
    return m;
  }, [filtered]);

  return (
    <div className="space-y-6 px-5 pt-1 pb-8">
      {/* 当前位置 hero · 玫瑰渐变描边 + glow */}
      {!trimmed && currentLocationLabel && currentCityId && (
        <section>
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
                  <div className="truncate font-serif-cn text-[16px] font-semibold text-ink-900">
                    {currentLocationLabel}
                  </div>
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

      {/* 搜索状态 hint */}
      {trimmed && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-warm-200 bg-warm-50/50 p-8 text-center">
          <Search className="mx-auto h-8 w-8 text-warm-300" strokeWidth={1.5} />
          <div className="mt-2 font-serif-cn text-[14px] font-medium text-ink-700">没找到「{search}」</div>
          <div className="mt-1 text-[12px] text-ink-500">换个关键词试试</div>
        </div>
      )}

      {/* 国家分组列表 */}
      {filtered.length > 0 && (
        <section className="space-y-5">
          {!trimmed && (
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              {currentLocationLabel ? '切换其他地区' : '选择地区'}
            </h3>
          )}
          {countries.map((co) => {
            const list = byCountry.get(co.country) ?? [];
            if (list.length === 0) return null;
            const activeCount = list.filter((x) => x.therapistCount > 0).reduce((s, x) => s + x.therapistCount, 0);
            return (
              <div key={co.country}>
                {/* 国家 header */}
                <div className="mb-2.5 flex items-end justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[22px] leading-none">{co.flag}</span>
                    <div>
                      <div className="font-serif-cn text-[15px] font-semibold text-ink-900">{co.label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-0.5 text-[11px] text-warm-700">
                    <span className="num font-bold">{activeCount}</span>
                    <span className="text-warm-600">位技师</span>
                  </div>
                </div>

                {/* 城市列表 */}
                <ul className="overflow-hidden rounded-2xl bg-white ring-1 ring-warm-100">
                  {list.map((c, idx) => {
                    const isCurrent = c.id === currentCityId;
                    const isEmpty = c.therapistCount === 0;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => !isEmpty && onPickCity(c)}
                          disabled={isEmpty}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition active:bg-warm-50/70 ${
                            idx > 0 ? 'border-t border-warm-50' : ''
                          } ${isEmpty ? 'cursor-not-allowed opacity-50' : ''} ${
                            isCurrent ? 'bg-gradient-to-r from-primary/[0.04] to-transparent' : ''
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                                isCurrent ? 'bg-primary' : isEmpty ? 'bg-ink-200' : 'bg-warm-300'
                              }`}
                            />
                            <span
                              className={`truncate text-[14.5px] ${
                                isCurrent ? 'font-semibold text-primary' : isEmpty ? 'text-ink-500' : 'font-medium text-ink-900'
                              }`}
                            >
                              {c.name}
                            </span>
                            {isCurrent && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                当前
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {isEmpty ? (
                              <span className="text-[12px] text-ink-400">暂未开通</span>
                            ) : (
                              <span className="flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-1 text-[12px]">
                                <span className="num font-bold text-warm-700">{c.therapistCount}</span>
                                <span className="text-warm-600">位</span>
                              </span>
                            )}
                            <span className={`text-[14px] ${isEmpty ? 'text-ink-300' : 'text-ink-400'}`}>→</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

// ──────────────────── 区域列表 step ────────────────────

function AreaBrowser({
  areas,
  currentAreaId,
  cityName,
  cityTherapistCount,
  onSelectAll,
  onSelectArea,
}: {
  areas: GeoArea[];
  currentAreaId: string | null;
  cityName: string;
  cityTherapistCount: number;
  onSelectAll: () => void;
  onSelectArea: (a: GeoArea) => void;
}) {
  return (
    <div className="space-y-5 px-5 pt-2 pb-8">
      {/* 城市标题 */}
      <div className="flex items-center gap-2 px-1">
        <MapPin className="h-4.5 w-4.5 text-primary" strokeWidth={2.4} />
        <span className="font-serif-cn text-[18px] font-semibold text-ink-900">{cityName}</span>
        <span className="ml-1 flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-0.5 text-[11px]">
          <span className="num font-bold text-warm-700">{cityTherapistCount}</span>
          <span className="text-warm-600">位</span>
        </span>
      </div>

      {/* 全城 · 大卡 */}
      <button
        type="button"
        onClick={onSelectAll}
        className={`flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left ring-1 transition active:bg-warm-50/70 ${
          currentAreaId === null
            ? 'bg-gradient-to-r from-primary/[0.06] to-transparent ring-primary/25'
            : 'bg-white ring-warm-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
              currentAreaId === null ? 'bg-gradient-cta text-white shadow-rose-md' : 'bg-warm-50 text-warm-600'
            }`}
          >
            🌐
          </div>
          <div>
            <div className="font-serif-cn text-[15px] font-semibold text-ink-900">全城范围</div>
            <div className="text-[11.5px] text-ink-500">不限区域 · 推荐试试</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-1 text-[12px]">
            <span className="num font-bold text-warm-700">{cityTherapistCount}</span>
            <span className="text-warm-600">位</span>
          </span>
          {currentAreaId === null && <Check className="h-5 w-5 text-primary" strokeWidth={2.5} />}
        </div>
      </button>

      {/* 细分区域 */}
      {areas.length > 0 && (
        <div>
          <h3 className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            细分区域
          </h3>
          <ul className="overflow-hidden rounded-2xl bg-white ring-1 ring-warm-100">
            {areas.map((a, idx) => {
              const isCurrent = a.id === currentAreaId;
              const isEmpty = a.therapistCount === 0;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => !isEmpty && onSelectArea(a)}
                    disabled={isEmpty}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition active:bg-warm-50/70 ${
                      idx > 0 ? 'border-t border-warm-50' : ''
                    } ${isEmpty ? 'cursor-not-allowed opacity-50' : ''} ${
                      isCurrent ? 'bg-gradient-to-r from-primary/[0.04] to-transparent' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          isCurrent ? 'bg-primary' : isEmpty ? 'bg-ink-200' : 'bg-warm-300'
                        }`}
                      />
                      <span
                        className={`truncate text-[14.5px] ${
                          isCurrent ? 'font-semibold text-primary' : isEmpty ? 'text-ink-500' : 'font-medium text-ink-900'
                        }`}
                      >
                        {a.name}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isEmpty ? (
                        <span className="text-[12px] text-ink-400">暂未开通</span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-warm-50 px-2.5 py-1 text-[12px]">
                          <span className="num font-bold text-warm-700">{a.therapistCount}</span>
                          <span className="text-warm-600">位</span>
                        </span>
                      )}
                      {isCurrent && <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {areas.length === 0 && (
        <div className="rounded-2xl border border-dashed border-warm-200 bg-warm-50/40 p-6 text-center">
          <div className="font-serif-cn text-[14px] font-medium text-ink-700">该城市无细分区域</div>
          <div className="mt-1 text-[12px] text-ink-500">点上方"全城范围"即可</div>
        </div>
      )}
    </div>
  );
}
