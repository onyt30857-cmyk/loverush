'use client';

/**
 * Admin · 汇率维护 · 0027
 *
 * 每个 currency 显示最新生效汇率(粗) + 历史汇率折叠
 * 改汇率 = 新建一条 effective_at=now · 历史保留(审计可追溯)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface RateHistory {
  id: string;
  pointsPerUnit: string;
  effectiveAt: string;
  isLatest: boolean;
}

interface RateGroup {
  currency_code: string;
  latest: string | null;
  history: RateHistory[];
}

export default function ExchangeRatesPage() {
  const [groups, setGroups] = useState<RateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null); // currency_code
  const [newRate, setNewRate] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<RateGroup[]>('/admin/exchange-rates');
      setGroups(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleExpand(code: string) {
    const next = new Set(expanded);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setExpanded(next);
  }

  function openNewRate(code: string) {
    const current = groups.find((g) => g.currency_code === code);
    setNewRate(current?.latest ?? '0');
    setEditing(code);
  }

  async function saveRate() {
    if (!editing) return;
    const value = parseFloat(newRate);
    if (!Number.isFinite(value) || value <= 0) {
      setError('汇率必须 > 0');
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/exchange-rates', {
        currency_code: editing,
        points_per_unit: value,
      });
      setEditing(null);
      setNewRate('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">汇率维护</h1>
          <p className="text-sm text-gray-500 mt-1">
            1 单位法币 = N 积分 · 用于换算客户心动金 · 改汇率 = 新建一条记录(历史保留)
          </p>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">{error}</div>}

        {loading ? (
          <div className="text-sm text-gray-500">加载中…</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.currency_code} className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold font-mono text-blue-700">{g.currency_code}</span>
                    <span className="text-sm text-gray-600">1 单位 =</span>
                    <span className="text-xl font-bold text-green-700">{g.latest ?? '—'}</span>
                    <span className="text-sm text-gray-600">积分(最新生效)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openNewRate(g.currency_code)}
                      className="bg-blue-600 text-white px-3 py-1 rounded text-xs"
                    >
                      改汇率
                    </button>
                    <button
                      onClick={() => toggleExpand(g.currency_code)}
                      className="text-xs text-gray-600 hover:underline"
                    >
                      {expanded.has(g.currency_code) ? '收起' : `历史 (${g.history.length})`}
                    </button>
                  </div>
                </div>
                {expanded.has(g.currency_code) && (
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs text-gray-500 bg-gray-50/50">
                        <th className="px-4 py-1.5 text-left">生效时间</th>
                        <th className="px-4 py-1.5 text-left">每单位积分</th>
                        <th className="px-4 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.history.map((h) => (
                        <tr key={h.id} className="text-sm border-t">
                          <td className="px-4 py-1.5 font-mono text-xs">
                            {new Date(h.effectiveAt).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-4 py-1.5">{h.pointsPerUnit}</td>
                          <td className="px-4 py-1.5">
                            {h.isLatest && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">最新</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-4">改汇率 · {editing}</h2>
              <div>
                <label className="block text-xs text-gray-600 mb-1">1 {editing} = N 积分</label>
                <input
                  type="number"
                  step="0.0001"
                  min={0.0001}
                  value={newRate}
                  onChange={(e) => setNewRate(e.target.value)}
                  className="border rounded px-3 py-1.5 w-full font-mono text-lg"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-2">改后立即生效 · 历史汇率保留 · 已下单订单按下单时汇率不变</p>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEditing(null)} className="px-4 py-1.5 rounded text-sm border">取消</button>
                <button onClick={() => void saveRate()} disabled={busy} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                  {busy ? '保存中…' : '生效'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
