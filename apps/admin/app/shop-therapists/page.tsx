'use client';

/**
 * Admin · 橱窗经营数据(技师维度)
 * 看哪些技师开通了橱窗、各自卖得怎么样(商品数/销量/GMV/点击/曝光)
 * 数据源:GET /admin/shop/summary + GET /admin/shop/therapists
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api } from '@/lib/api';

interface Summary {
  therapistsWithShop: number;
  totalListings: number;
  totalSold: number;
  totalGmv: number;
  totalClicks: number;
  totalImpressions: number;
}

interface TherapistRow {
  therapistId: string;
  therapistName: string | null;
  listingCount: number;
  sold: number;
  gmv: number;
  clicks: number;
  impressions: number;
  ctr: number;
  openedAt: string;
}

const ORDER_OPTIONS = [
  { value: 'gmv', label: 'GMV' },
  { value: 'sold', label: '销量' },
  { value: 'listings', label: '商品数' },
  { value: 'clicks', label: '点击' },
] as const;

function Kpi({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">
        {value}
        {suffix ? <span className="ml-1 text-sm font-normal text-gray-400">{suffix}</span> : null}
      </div>
    </div>
  );
}

export default function ShopTherapistsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<TherapistRow[] | null>(null);
  const [orderBy, setOrderBy] = useState<string>('gmv');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Summary>('/admin/shop/summary').then(setSummary).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    setRows(null);
    api
      .get<TherapistRow[]>('/admin/shop/therapists', { order_by: orderBy, limit: 200 })
      .then(setRows)
      .catch((e) => setErr(String(e)));
  }, [orderBy]);

  return (
    <AdminShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">橱窗经营数据</h1>
          <p className="text-sm text-gray-500 mt-1">
            哪些技师开通了橱窗 · 各自卖得怎么样(销量 / GMV / 点击 / 曝光)
          </p>
        </div>

        {err ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">{err}</div>
        ) : null}

        {/* KPI 概览 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <Kpi label="开通橱窗技师" value={summary?.therapistsWithShop ?? '—'} suffix="人" />
          <Kpi label="总上架商品" value={summary?.totalListings ?? '—'} suffix="件" />
          <Kpi label="总销量" value={summary?.totalSold ?? '—'} suffix="件" />
          <Kpi label="总 GMV" value={(summary?.totalGmv ?? 0).toLocaleString()} suffix="积分" />
          <Kpi label="总点击" value={(summary?.totalClicks ?? 0).toLocaleString()} />
          <Kpi label="总曝光" value={(summary?.totalImpressions ?? 0).toLocaleString()} />
        </div>

        {/* 排序 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-gray-500">排序</span>
          {ORDER_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOrderBy(o.value)}
              className={`px-3 py-1 rounded text-sm ${
                orderBy === o.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* 技师列表 */}
        {rows === null ? (
          <div className="text-sm text-gray-500">加载中…</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-600">
                <th className="px-3 py-2 border-b">#</th>
                <th className="px-3 py-2 border-b">技师</th>
                <th className="px-3 py-2 border-b">商品数</th>
                <th className="px-3 py-2 border-b">销量</th>
                <th className="px-3 py-2 border-b">GMV(积分)</th>
                <th className="px-3 py-2 border-b">点击</th>
                <th className="px-3 py-2 border-b">曝光</th>
                <th className="px-3 py-2 border-b">点击率</th>
                <th className="px-3 py-2 border-b">开通时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-gray-400">
                    还没有技师开通橱窗
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.therapistId} className="hover:bg-gray-50 text-sm">
                    <td className="px-3 py-2 border-b text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 border-b font-medium">{r.therapistName ?? '—'}</td>
                    <td className="px-3 py-2 border-b">{r.listingCount}</td>
                    <td className="px-3 py-2 border-b">{r.sold}</td>
                    <td className="px-3 py-2 border-b font-mono">{r.gmv.toLocaleString()}</td>
                    <td className="px-3 py-2 border-b">{r.clicks}</td>
                    <td className="px-3 py-2 border-b">{r.impressions}</td>
                    <td className="px-3 py-2 border-b">{(r.ctr * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 border-b text-xs text-gray-500">
                      {r.openedAt ? new Date(r.openedAt).toLocaleDateString('zh-CN') : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
