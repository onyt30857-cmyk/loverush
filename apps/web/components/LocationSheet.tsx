/**
 * 位置选择 BottomSheet · M02 Phase 5.1 数据驱动重设计
 *
 * 顶部 "当前位置" 卡片(高亮) + 下面按国家分组的城市列表(含技师数)
 * 点城市 → step='area' 展开该城所有区域(含技师数)
 * 0 技师城市/区域:灰化 + "暂未开通"标
 *
 * 数据源:
 *   GET /geo/countries     聚合每国家(flag/label/cityCount/therapistCount)
 *   GET /geo/cities        每城市含 therapistCount
 *   GET /geo/cities/:id/areas 每区域含 therapistCount
 */
'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Check, MapPin, X } from 'lucide-react';
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
  const { areas } = useAreas(drillCityId);

  useEffect(() => {
    if (!isOpen) return;
    setDrillCityId(null); // 每次打开回主列表
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-label="关闭" />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 max-h-[88%] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
      >
        {/* 顶部 */}
        <div className="sticky top-0 z-10 bg-white pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between border-b border-warm-100 px-4 pb-2.5">
            {drillCityId ? (
              <button
                type="button"
                onClick={() => setDrillCityId(null)}
                className="flex items-center gap-1.5 text-[14px] text-ink-700 active:text-ink-900"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>返回</span>
              </button>
            ) : (
              <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-800">
                <MapPin className="h-4 w-4 text-primary" />
                选择位置
              </h2>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 主体 */}
        {!drillCityId && (
          <CityBrowser
            cities={cities}
            countries={countries}
            currentCityId={currentCityId}
            currentLocationLabel={
              pref?.cityName
                ? `${pref.cityName}${pref.areaName ? ' · ' + pref.areaName : ''}`
                : null
            }
            currentCountryFromCity={cities.find((c) => c.id === currentCityId)?.country ?? null}
            currentCityTherapistCount={cities.find((c) => c.id === currentCityId)?.therapistCount ?? null}
            onPickCity={(city) => {
              // 直接进入该城市的区域 step · 让用户决定全城 or 指定区
              setDrillCityId(city.id);
            }}
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
    </>
  );
}

// ──────────────────── 主列表:当前位置 + 国家分组 ────────────────────

function CityBrowser({
  cities,
  countries,
  currentCityId,
  currentLocationLabel,
  currentCountryFromCity,
  currentCityTherapistCount,
  onPickCity,
}: {
  cities: GeoCity[];
  countries: ReturnType<typeof useCountries>['countries'];
  currentCityId: string | null;
  currentLocationLabel: string | null;
  currentCountryFromCity: string | null;
  currentCityTherapistCount: number | null;
  onPickCity: (c: GeoCity) => void;
}) {
  // 按 country 分组
  const byCountry = new Map<string, GeoCity[]>();
  for (const c of cities) {
    if (!byCountry.has(c.country)) byCountry.set(c.country, []);
    byCountry.get(c.country)!.push(c);
  }

  const currentCountryMeta = currentCountryFromCity ? countries.find((c) => c.country === currentCountryFromCity) : null;

  return (
    <div className="space-y-5 px-4 pb-4 pt-3">
      {/* 当前位置卡片 */}
      {currentLocationLabel && currentCityId && (
        <section>
          <h3 className="mb-1.5 flex items-center gap-1 text-[11.5px] font-medium text-warm-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            当前位置
          </h3>
          <div className="rounded-2xl border-2 border-warm-300 bg-warm-50/60 p-3.5 shadow-warm-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink-800">{currentLocationLabel}</div>
                  <div className="text-[11.5px] text-ink-500">
                    {currentCountryMeta?.flag} {currentCountryMeta?.label}
                    {typeof currentCityTherapistCount === 'number' && (
                      <>
                        {' · '}
                        <span className="font-semibold text-warm-700">{currentCityTherapistCount}</span> 位技师
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Check className="h-5 w-5 text-primary" />
            </div>
          </div>
        </section>
      )}

      {/* 其他地区 */}
      <section>
        <h3 className="mb-1.5 text-[11.5px] font-medium text-ink-500">
          {currentLocationLabel ? '切换其他地区' : '选择地区'}
        </h3>
        <div className="space-y-4">
          {countries.map((co) => {
            const list = byCountry.get(co.country) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={co.country}>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{co.flag}</span>
                    <span className="text-[12.5px] font-medium text-ink-700">{co.label}</span>
                  </div>
                  <span className="text-[11px] text-ink-500">
                    共 <span className="font-semibold text-warm-700">{co.therapistCount}</span> 位
                  </span>
                </div>
                <ul className="overflow-hidden rounded-2xl border border-warm-100 bg-white">
                  {list.map((c, idx) => {
                    const isCurrent = c.id === currentCityId;
                    const isEmpty = c.therapistCount === 0;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => onPickCity(c)}
                          className={`flex w-full items-center justify-between px-3.5 py-3 text-left transition active:bg-warm-50 ${
                            idx > 0 ? 'border-t border-warm-50' : ''
                          } ${isEmpty ? 'opacity-50' : ''}`}
                        >
                          <span className={`text-[13.5px] ${isCurrent ? 'font-semibold text-warm-700' : 'text-ink-800'}`}>
                            {c.name}
                            {isCurrent && <span className="ml-1.5 text-[10px] text-primary">· 当前</span>}
                          </span>
                          <span className="flex items-center gap-1 text-[12px]">
                            {isEmpty ? (
                              <span className="text-ink-400">暂未开通</span>
                            ) : (
                              <>
                                <span className="font-mono font-semibold text-warm-700">{c.therapistCount}</span>
                                <span className="text-ink-400">位</span>
                              </>
                            )}
                            <span className="ml-0.5 text-ink-300">→</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
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
    <div className="space-y-3 px-4 pb-4 pt-3">
      <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-800">
        <MapPin className="h-4 w-4 text-primary" />
        {cityName}
        <span className="ml-1 text-[11.5px] font-normal text-ink-500">
          · <span className="font-semibold text-warm-700">{cityTherapistCount}</span> 位技师
        </span>
      </div>

      {/* 全城 */}
      <ul className="overflow-hidden rounded-2xl border border-warm-100 bg-white">
        <li>
          <button
            type="button"
            onClick={onSelectAll}
            className={`flex w-full items-center justify-between px-3.5 py-3 text-left active:bg-warm-50 ${
              currentAreaId === null ? 'bg-warm-50/50' : ''
            }`}
          >
            <span className="text-[13.5px] font-medium text-ink-800">🌐 全城范围</span>
            <span className="flex items-center gap-1 text-[12px]">
              <span className="font-mono font-semibold text-warm-700">{cityTherapistCount}</span>
              <span className="text-ink-400">位</span>
              {currentAreaId === null && <Check className="ml-1 h-4 w-4 text-primary" />}
            </span>
          </button>
        </li>
      </ul>

      {areas.length > 0 && (
        <div>
          <h3 className="mb-1.5 px-1 text-[11.5px] font-medium text-ink-500">细分区域</h3>
          <ul className="overflow-hidden rounded-2xl border border-warm-100 bg-white">
            {areas.map((a, idx) => {
              const isCurrent = a.id === currentAreaId;
              const isEmpty = a.therapistCount === 0;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelectArea(a)}
                    className={`flex w-full items-center justify-between px-3.5 py-3 text-left transition active:bg-warm-50 ${
                      idx > 0 ? 'border-t border-warm-50' : ''
                    } ${isEmpty ? 'opacity-50' : ''}`}
                  >
                    <span className={`text-[13.5px] ${isCurrent ? 'font-semibold text-warm-700' : 'text-ink-800'}`}>
                      {a.name}
                      {isCurrent && <span className="ml-1.5 text-[10px] text-primary">· 当前</span>}
                    </span>
                    <span className="flex items-center gap-1 text-[12px]">
                      {isEmpty ? (
                        <span className="text-ink-400">暂未开通</span>
                      ) : (
                        <>
                          <span className="font-mono font-semibold text-warm-700">{a.therapistCount}</span>
                          <span className="text-ink-400">位</span>
                        </>
                      )}
                      {isCurrent && <Check className="ml-1 h-4 w-4 text-primary" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {areas.length === 0 && (
        <div className="rounded-2xl bg-ink-50 p-4 text-center text-[12px] text-ink-500">
          该城市暂无细分区域 · 选"全城范围"即可
        </div>
      )}
    </div>
  );
}
