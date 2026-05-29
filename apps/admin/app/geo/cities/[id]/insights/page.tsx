/**
 * Admin · 单城市深度 insight · M02 Phase 5.2
 *
 * 4 卡 + 状态分布 + 价格统计 + Top 10 技师 + 区域 breakdown
 */
'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface DeepInsight {
  city: { id: string; code: string; name: string; country: string; flag: string };
  metrics: {
    therapistCount: number;
    customerCount: number;
    orders30d: number;
    gmv30d: number;
    completionRate: number;
    avgRating: number | null;
    avgPrice: number | null;
  };
  statusBreakdown: Record<string, number>;
  topTherapists: Array<{
    therapistId: string;
    userId: string;
    displayName: string | null;
    scoreService: number;
    orders30d: number;
    gmv30d: number;
  }>;
  areasBreakdown: Array<{
    areaId: string;
    code: string;
    name: string;
    therapistCount: number;
    orders30d: number;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_CONFIRM: '待确认',
  LOCKED: '已锁价',
  PAID: '已支付',
  IN_SERVICE: '进行中',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '取消',
  DISPUTED: '争议',
  REFUNDED: '退款',
  CLOSED: '关闭',
};

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'bg-green-500',
  REVIEWED: 'bg-green-600',
  PAID: 'bg-blue-500',
  IN_SERVICE: 'bg-blue-400',
  CANCELLED: 'bg-ink-400',
  DISPUTED: 'bg-orange-500',
  REFUNDED: 'bg-red-500',
};

export default function CityInsightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<DeepInsight | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.get<DeepInsight>(`/admin/geo/cities/${id}/insights`));
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [id]);

  if (!data) {
    return (
      <AdminShell>
        {error ? (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        ) : (
          <div className="text-ink-500">加载中…</div>
        )}
      </AdminShell>
    );
  }

  const totalStatus = Object.values(data.statusBreakdown).reduce((a, b) => a + b, 0);

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {data.city.flag} {data.city.name} · 深度看板
        </h1>
        <Link href="/geo/dashboard" className="btn-ghost">
          ← 返回总览
        </Link>
      </div>

      {/* 4 卡 */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat label="认证技师" value={data.metrics.therapistCount} />
        <Stat label="客户偏好" value={data.metrics.customerCount} />
        <Stat label="30 天订单" value={data.metrics.orders30d} />
        <Stat label="30 天 GMV" value={data.metrics.gmv30d.toLocaleString()} suffix="积分" />
      </div>

      {/* 概览 + 价格 */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs text-ink-500">完成率(30d)</div>
          <div className="mt-1 text-2xl font-bold text-ink-800">
            {data.metrics.completionRate < 0 ? '—' : `${(data.metrics.completionRate * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-500">平均评分</div>
          <div className="mt-1 text-2xl font-bold text-ink-800">
            {data.metrics.avgRating == null
              ? '—'
              : `${(data.metrics.avgRating / 10).toFixed(1)}★`}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-500">60min 平均价</div>
          <div className="mt-1 text-2xl font-bold text-ink-800">
            {data.metrics.avgPrice == null ? '—' : `${data.metrics.avgPrice.toLocaleString()} 积分`}
          </div>
        </div>
      </div>

      {/* 状态分布 */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 text-base font-semibold">订单状态分布(30 天)</h2>
        {totalStatus === 0 ? (
          <div className="py-4 text-center text-ink-400">暂无订单</div>
        ) : (
          <div className="space-y-2">
            {Object.entries(data.statusBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([status, n]) => {
                const w = (n / totalStatus) * 100;
                const color = STATUS_COLOR[status] ?? 'bg-ink-300';
                return (
                  <div key={status} className="flex items-center gap-3">
                    <div className="w-24 text-right text-xs text-ink-700">{STATUS_LABEL[status] ?? status}</div>
                    <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-ink-100">
                      <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
                      <span className="absolute inset-0 flex items-center justify-end pr-2 text-xs font-mono text-ink-800">
                        {n} · {w.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Top 10 技师 */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 text-base font-semibold">Top 10 技师(按 30d GMV)</h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>技师</th>
                <th>评分</th>
                <th>30d 订单</th>
                <th>30d GMV</th>
              </tr>
            </thead>
            <tbody>
              {data.topTherapists.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-ink-400">
                    暂无技师
                  </td>
                </tr>
              )}
              {data.topTherapists.map((t, i) => (
                <tr key={t.therapistId}>
                  <td className="font-mono">{i + 1}</td>
                  <td>{t.displayName ?? '未填昵称'}</td>
                  <td className="font-mono">{(t.scoreService / 10).toFixed(1)}★</td>
                  <td className="font-mono">{t.orders30d}</td>
                  <td className="font-mono">{t.gmv30d.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 区域 breakdown */}
      <div className="card p-5">
        <h2 className="mb-3 text-base font-semibold">区域 breakdown</h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>区域</th>
                <th>技师数</th>
              </tr>
            </thead>
            <tbody>
              {data.areasBreakdown.length === 0 && (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-ink-400">
                    该城市暂无细分区域
                  </td>
                </tr>
              )}
              {data.areasBreakdown.map((a) => (
                <tr key={a.areaId}>
                  <td>{a.name}</td>
                  <td className="font-mono">{a.therapistCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
