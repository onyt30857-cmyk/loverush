/**
 * Admin · 地域总览看板 · M02 Phase 5.2
 *
 * 4 卡 + tab 切换"按城市/按国家" + 表格
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Summary {
  cityCount: number;
  therapistCount: number;
  customerCount: number;
  orders30d: number;
  gmv30d: number;
}

interface CityInsight {
  cityId: string;
  cityCode: string;
  name: string;
  country: string;
  flag: string;
  therapistCount: number;
  customerCount: number;
  orders30d: number;
  gmv30d: number;
  completionRate: number;
}

interface CountryInsight {
  country: string;
  flag: string;
  label: string;
  cityCount: number;
  therapistCount: number;
  customerCount: number;
  orders30d: number;
  gmv30d: number;
}

type Tab = 'city' | 'country';

export default function GeoDashboardPage() {
  const [tab, setTab] = useState<Tab>('city');
  const [country, setCountry] = useState<string>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cities, setCities] = useState<CityInsight[]>([]);
  const [countries, setCountries] = useState<CountryInsight[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const path = country ? `/admin/geo/dashboard/summary?country=${country}` : '/admin/geo/dashboard/summary';
        const res = await api.get<{ summary: Summary; cities: CityInsight[] }>(path);
        setSummary(res.summary);
        setCities(res.cities);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [country]);

  useEffect(() => {
    if (tab !== 'country') return;
    void (async () => {
      try {
        setCountries(await api.get<CountryInsight[]>('/admin/geo/dashboard/by-country'));
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [tab]);

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🌏 地域总览看板</h1>
        <div className="text-xs text-ink-500">数据窗口:近 30 天滚动</div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 4 卡 */}
      <div className="mb-6 grid grid-cols-5 gap-4">
        <Stat label="开通城市" value={summary?.cityCount ?? 0} />
        <Stat label="认证技师" value={summary?.therapistCount ?? 0} />
        <Stat label="客户偏好" value={summary?.customerCount ?? 0} />
        <Stat label="30 天订单" value={summary?.orders30d ?? 0} />
        <Stat label="30 天 GMV" value={(summary?.gmv30d ?? 0).toLocaleString()} suffix="积分" />
      </div>

      {/* tab 切换 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab('city')}
            className={`rounded-lg px-4 py-1.5 text-sm ${
              tab === 'city' ? 'bg-primary text-white' : 'bg-ink-100 text-ink-700'
            }`}
          >
            按城市
          </button>
          <button
            type="button"
            onClick={() => setTab('country')}
            className={`rounded-lg px-4 py-1.5 text-sm ${
              tab === 'country' ? 'bg-primary text-white' : 'bg-ink-100 text-ink-700'
            }`}
          >
            按国家
          </button>
        </div>

        {tab === 'city' && (
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="input h-9 text-sm">
            <option value="">所有国家</option>
            <option value="TH">🇹🇭 泰国</option>
            <option value="MY">🇲🇾 马来西亚</option>
            <option value="VN">🇻🇳 越南</option>
            <option value="ID">🇮🇩 印度尼西亚</option>
          </select>
        )}
      </div>

      {/* 表格 · 城市 */}
      {tab === 'city' && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>城市</th>
                <th>国家</th>
                <th>技师数</th>
                <th>客户偏好</th>
                <th>30d 订单</th>
                <th>30d GMV</th>
                <th>完成率</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {cities.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-ink-500">
                    暂无数据
                  </td>
                </tr>
              )}
              {cities.map((c) => (
                <tr key={c.cityId}>
                  <td>{c.name}</td>
                  <td className="text-xs">{c.flag} {c.country}</td>
                  <td className="font-mono">{c.therapistCount}</td>
                  <td className="font-mono">{c.customerCount}</td>
                  <td className="font-mono">{c.orders30d}</td>
                  <td className="font-mono font-semibold">{c.gmv30d.toLocaleString()}</td>
                  <td className="font-mono">
                    {c.completionRate < 0 ? '—' : `${(c.completionRate * 100).toFixed(0)}%`}
                  </td>
                  <td className="text-right">
                    <Link href={`/geo/cities/${c.cityId}/insights`} className="btn-ghost h-7 px-3 text-xs">
                      详情 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 表格 · 国家 */}
      {tab === 'country' && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>国家</th>
                <th>开通城市</th>
                <th>技师总数</th>
                <th>客户总数</th>
                <th>30d 订单</th>
                <th>30d GMV</th>
              </tr>
            </thead>
            <tbody>
              {countries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink-500">
                    暂无数据
                  </td>
                </tr>
              )}
              {countries.map((co) => (
                <tr key={co.country}>
                  <td>{co.flag} {co.label}</td>
                  <td className="font-mono">{co.cityCount}</td>
                  <td className="font-mono">{co.therapistCount}</td>
                  <td className="font-mono">{co.customerCount}</td>
                  <td className="font-mono">{co.orders30d}</td>
                  <td className="font-mono font-semibold">{co.gmv30d.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-ink-800">{value}</span>
        {suffix && <span className="text-xs text-ink-500">{suffix}</span>}
      </div>
    </div>
  );
}
