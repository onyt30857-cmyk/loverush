/**
 * Admin · Query 看板 · M02 Phase 4
 *
 * 4 张卡片(24h/7d/30d 搜索量 + 唯一用户 + 零结果率 + CTR + 个性化覆盖率)
 * + 热门词 TOP 50 表
 * + **零结果词 TOP 50 表(红色高亮 · 指导补内容)**
 * + 明细分页
 */
'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface RangeStats {
  total: number;
  unique_users: number;
  zero_count: number;
  click_count: number;
  personalized_count: number;
  zero_rate: number;
  ctr: number;
  personalized_rate: number;
}

interface Overview {
  '24h'?: RangeStats;
  '7d'?: RangeStats;
  '30d'?: RangeStats;
}

interface HotRow {
  raw_query: string;
  count: number;
  unique_users: number;
  clicks: number;
  ctr: number;
  avg_result_count: number;
}

interface ZeroRow {
  raw_query: string;
  count: number;
  unique_users: number;
  last_seen: string;
}

const RANGES = ['24h', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

export default function SearchAnalyticsPage() {
  const [overview, setOverview] = useState<Overview>({});
  const [range, setRange] = useState<Range>('7d');
  const [hot, setHot] = useState<HotRow[]>([]);
  const [zero, setZero] = useState<ZeroRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const ov = await api.get<Overview>('/admin/search/overview');
        setOverview(ov);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [h, z] = await Promise.all([
          api.get<HotRow[]>(`/admin/search/queries/hot?range=${range}`),
          api.get<ZeroRow[]>(`/admin/search/queries/zero?range=${range}`),
        ]);
        setHot(h);
        setZero(z);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [range]);

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Query 看板 · 搜索行为洞察</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-lg px-3 py-1 text-xs ${
                range === r ? 'bg-primary text-white' : 'bg-ink-100 text-ink-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 总览 4 卡 · 按当前 range */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <StatCard label="搜索总量" value={overview[range]?.total ?? 0} loading={loading} />
        <StatCard label="唯一用户" value={overview[range]?.unique_users ?? 0} loading={loading} />
        <StatCard
          label="零结果率"
          value={`${((overview[range]?.zero_rate ?? 0) * 100).toFixed(1)}%`}
          tone={overview[range]?.zero_rate && overview[range]!.zero_rate > 0.2 ? 'warn' : 'ok'}
          loading={loading}
        />
        <StatCard label="CTR" value={`${((overview[range]?.ctr ?? 0) * 100).toFixed(1)}%`} loading={loading} />
      </div>

      {/* 个性化覆盖率 · 单独一行 */}
      <div className="mb-6 rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700">
        个性化排序覆盖率(personalize=true 的占比):{' '}
        <span className="font-mono font-bold text-primary">
          {((overview[range]?.personalized_rate ?? 0) * 100).toFixed(1)}%
        </span>{' '}
        · {overview[range]?.personalized_count ?? 0} / {overview[range]?.total ?? 0}
      </div>

      {/* 零结果词 · 红色高亮 · 最有运营价值 */}
      <div className="mb-6">
        <h2 className="mb-2 text-lg font-semibold text-red-700">🚨 零结果词 TOP 50（{range}）</h2>
        <p className="mb-2 text-xs text-ink-500">
          这些词用户搜了但没结果 · 可能是技师不够、命名不对应、或运营盲区
        </p>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>搜索词</th>
                <th>次数</th>
                <th>唯一用户</th>
                <th>最近一次</th>
              </tr>
            </thead>
            <tbody>
              {zero.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink-400">
                    🎉 当前范围内没有零结果词
                  </td>
                </tr>
              )}
              {zero.map((z) => (
                <tr key={z.raw_query} className="bg-red-50/40">
                  <td className="font-mono text-xs">{z.raw_query}</td>
                  <td>{z.count}</td>
                  <td>{z.unique_users}</td>
                  <td className="text-xs text-ink-500">
                    {z.last_seen ? new Date(z.last_seen).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 热门词 */}
      <div className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">🔥 热门词 TOP 50（{range}）</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>搜索词</th>
                <th>次数</th>
                <th>唯一用户</th>
                <th>点击</th>
                <th>CTR</th>
                <th>平均结果数</th>
              </tr>
            </thead>
            <tbody>
              {hot.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-400">
                    还没有数据
                  </td>
                </tr>
              )}
              {hot.map((h) => (
                <tr key={h.raw_query}>
                  <td className="font-mono text-xs">{h.raw_query}</td>
                  <td>{h.count}</td>
                  <td>{h.unique_users}</td>
                  <td>{h.clicks}</td>
                  <td className="font-mono">{(h.ctr * 100).toFixed(1)}%</td>
                  <td>{h.avg_result_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}

function StatCard({
  label,
  value,
  tone = 'ok',
  loading,
}: {
  label: string;
  value: number | string;
  tone?: 'ok' | 'warn';
  loading?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold ${
          tone === 'warn' ? 'text-red-600' : 'text-ink-800'
        } ${loading ? 'opacity-30' : ''}`}
      >
        {loading ? '…' : value}
      </div>
    </div>
  );
}
