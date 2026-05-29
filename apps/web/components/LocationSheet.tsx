/**
 * 位置选择 BottomSheet · M02 Phase 5
 *
 * 两级选择(city → area)· 城市搜索 + 列表 + 区域(可选"全部区域")
 * 选完即触发 onSelect + 关闭
 * absolute 贴 .mobile-container 内部底部 · 与 LocaleSheet 同款风格
 */
'use client';

import { useEffect, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import { useCities, useAreas, type GeoCity, type GeoArea } from '@/lib/location';

interface Props {
  isOpen: boolean;
  currentCityId: string | null;
  currentAreaId: string | null;
  onClose: () => void;
  onSelect: (args: { cityId: string; areaId: string | null }) => void;
}

export function LocationSheet({ isOpen, currentCityId, currentAreaId, onClose, onSelect }: Props) {
  const { cities } = useCities();
  const [pendingCityId, setPendingCityId] = useState<string | null>(currentCityId);
  const [step, setStep] = useState<'city' | 'area'>('city');
  const [query, setQuery] = useState('');
  const { areas } = useAreas(pendingCityId);

  useEffect(() => {
    if (!isOpen) return;
    setPendingCityId(currentCityId);
    setStep(currentCityId ? 'area' : 'city');
    setQuery('');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen, currentCityId]);

  if (!isOpen) return null;

  const visibleCities = query
    ? cities.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.code.includes(query.toLowerCase()))
    : cities;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-label="关闭" />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 max-h-[85%] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
      >
        {/* 顶部 */}
        <div className="sticky top-0 z-10 bg-white pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between border-b border-warm-100 px-4 pb-2.5">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-800">
              <MapPin className="h-4 w-4 text-primary" />
              选择位置
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* step tab */}
          <div className="flex gap-1 px-4 py-2">
            <button
              type="button"
              onClick={() => setStep('city')}
              className={`flex-1 rounded-full py-1.5 text-[12px] ${
                step === 'city' ? 'bg-warm-50 font-medium text-warm-700' : 'text-ink-500'
              }`}
            >
              ① 城市
            </button>
            <button
              type="button"
              onClick={() => pendingCityId && setStep('area')}
              disabled={!pendingCityId}
              className={`flex-1 rounded-full py-1.5 text-[12px] ${
                step === 'area' ? 'bg-warm-50 font-medium text-warm-700' : 'text-ink-500'
              } disabled:opacity-40`}
            >
              ② 区域
            </button>
          </div>
        </div>

        {/* 内容 */}
        {step === 'city' && (
          <CityList
            cities={visibleCities}
            currentId={pendingCityId}
            query={query}
            onQuery={setQuery}
            onSelect={(c) => {
              setPendingCityId(c.id);
              setStep('area');
            }}
          />
        )}

        {step === 'area' && pendingCityId && (
          <AreaList
            areas={areas}
            currentId={currentAreaId}
            onSelectAll={() => {
              onSelect({ cityId: pendingCityId, areaId: null });
              onClose();
            }}
            onSelect={(a) => {
              onSelect({ cityId: pendingCityId, areaId: a.id });
              onClose();
            }}
          />
        )}
      </div>
    </>
  );
}

function CityList({
  cities,
  currentId,
  query,
  onQuery,
  onSelect,
}: {
  cities: GeoCity[];
  currentId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (c: GeoCity) => void;
}) {
  // 按国家分组
  const byCountry = new Map<string, GeoCity[]>();
  for (const c of cities) {
    if (!byCountry.has(c.country)) byCountry.set(c.country, []);
    byCountry.get(c.country)!.push(c);
  }
  const COUNTRY_LABEL: Record<string, string> = { TH: '🇹🇭 泰国', MY: '🇲🇾 马来西亚', VN: '🇻🇳 越南', ID: '🇮🇩 印尼' };

  return (
    <div className="space-y-3 px-4 pb-4">
      <input
        type="text"
        placeholder="搜索城市…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        className="w-full rounded-2xl border border-warm-100 bg-ink-50 px-4 py-2 text-[13px] outline-none"
        autoFocus
      />
      {cities.length === 0 && <div className="py-6 text-center text-[12px] text-ink-400">没有匹配的城市</div>}
      {[...byCountry.entries()].map(([country, list]) => (
        <section key={country}>
          <h3 className="mb-1.5 text-[11px] text-ink-500">{COUNTRY_LABEL[country] ?? country}</h3>
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left active:bg-warm-50 ${
                    currentId === c.id ? 'bg-warm-50' : ''
                  }`}
                >
                  <span className="text-[13.5px] text-ink-800">{c.name}</span>
                  {currentId === c.id && <Check className="h-4 w-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AreaList({
  areas,
  currentId,
  onSelectAll,
  onSelect,
}: {
  areas: GeoArea[];
  currentId: string | null;
  onSelectAll: () => void;
  onSelect: (a: GeoArea) => void;
}) {
  return (
    <div className="space-y-1 px-4 pb-4">
      <button
        type="button"
        onClick={onSelectAll}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left active:bg-warm-50 ${
          currentId === null ? 'bg-warm-50' : ''
        }`}
      >
        <span className="text-[13.5px] text-ink-800">全城范围</span>
        {currentId === null && <Check className="h-4 w-4 text-primary" />}
      </button>
      {areas.length === 0 && <div className="py-6 text-center text-[12px] text-ink-400">该城市暂无细分区域</div>}
      {areas.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onSelect(a)}
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left active:bg-warm-50 ${
            currentId === a.id ? 'bg-warm-50' : ''
          }`}
        >
          <span className="text-[13.5px] text-ink-800">{a.name}</span>
          {currentId === a.id && <Check className="h-4 w-4 text-primary" />}
        </button>
      ))}
    </div>
  );
}
