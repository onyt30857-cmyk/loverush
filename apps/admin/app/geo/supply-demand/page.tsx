/**
 * Admin · 供需缺口图 · M02 Phase 5.2
 *
 * 5 个 status:
 *   critical_shortage(红)/shortage(黄)/balanced(绿)/oversupply(蓝)/unopened(灰)
 * 横向柱图(CSS-only · 不引入 chart 库)+ 表格
 */
'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

type Status = 'critical_shortage' | 'shortage' | 'balanced' | 'oversupply' | 'unopened';

interface Row {
  cityId: string;
  cityCode: string;
  name: string;
  country: string;
  flag: string;
  therapistCount: number;
  customerCount: number;
  ratio: number | null;
  status: Status;
  suggestion: string;
}

const STATUS_META: Record<Status, { color: string; bg: string; label: string }> = {
  critical_shortage: { color: 'text-red-700', bg: 'bg-red-500', label: '严重缺技师' },
  shortage: { color: 'text-yellow-700', bg: 'bg-yellow-500', label: '轻度缺' },
  balanced: { color: 'text-green-700', bg: 'bg-green-500', label: '平衡' },
  oversupply: { color: 'text-blue-700', bg: 'bg-blue-500', label: '供给过剩' },
  unopened: { color: 'text-ink-500', bg: 'bg-ink-400', label: '暂未开通' },
};

export default function SupplyDemandPage() {
  const [list, setList] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setList(await api.get<Row[]>('/admin/geo/supply-demand'));
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, []);

  const maxRatio = Math.max(0.1, ...list.map((r) => r.ratio ?? 0));

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">📊 供需缺口图</h1>
        <div className="text-xs text-ink-500">供需比 = 客户偏好数 / 技师数</div>
      </div>

      {/* 说明 */}
      <div className="mb-4 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
        <div className="mb-2 font-medium">如何阅读:</div>
        <div className="flex flex-wrap gap-3 text-xs">
          {(['critical_shortage', 'shortage', 'balanced', 'oversupply', 'unopened'] as Status[]).map((s) => (
            <span key={s} className={`flex items-center gap-1 ${STATUS_META[s].color}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_META[s].bg}`} />
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 柱图区 · CSS-only · width % */}
      <div className="card mb-6 p-5">
        <h2 className="mb-3 text-base font-semibold">柱图(按供需比降序)</h2>
        <div className="space-y-2">
          {list.length === 0 && <div className="py-6 text-center text-ink-400">暂无数据</div>}
          {list.map((r) => {
            const meta = STATUS_META[r.status];
            const w = r.ratio == null ? 5 : Math.min(100, (r.ratio / maxRatio) * 100);
            return (
              <div key={r.cityId} className="flex items-center gap-3">
                <div className="w-24 shrink-0 text-right text-xs text-ink-700">
                  {r.flag} {r.name}
                </div>
                <div className="flex-1">
                  <div className="relative h-6 overflow-hidden rounded-lg bg-ink-100">
                    <div className={`h-full ${meta.bg}`} style={{ width: `${w}%` }} />
                    <span className="absolute inset-0 flex items-center justify-end pr-2 text-xs font-mono text-ink-800">
                      {r.ratio == null ? '∞ / 0' : r.ratio.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className={`w-20 shrink-0 text-xs ${meta.color}`}>{meta.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 表格 */}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>城市</th>
              <th>国家</th>
              <th>技师</th>
              <th>客户偏好</th>
              <th>供需比</th>
              <th>状态</th>
              <th>建议</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <tr key={r.cityId}>
                  <td>{r.name}</td>
                  <td className="text-xs">{r.flag} {r.country}</td>
                  <td className="font-mono">{r.therapistCount}</td>
                  <td className="font-mono">{r.customerCount}</td>
                  <td className="font-mono">{r.ratio == null ? '—' : r.ratio.toFixed(2)}</td>
                  <td>
                    <span className={`flex items-center gap-1 text-xs ${meta.color}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${meta.bg}`} />
                      {meta.label}
                    </span>
                  </td>
                  <td className="text-xs">{r.suggestion}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
