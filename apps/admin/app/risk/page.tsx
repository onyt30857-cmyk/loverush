'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface RiskEvent {
  id: string;
  subjectUserId: string | null;
  subjectType: string;
  eventType: string;
  severity: number;
  payload: Record<string, unknown>;
  resolvedAt: string | null;
  createdAt: string;
}

const RESOLUTIONS = ['dismiss', 'warn', 'suspend', 'ban'] as const;

export default function RiskPage() {
  const [list, setList] = useState<RiskEvent[]>([]);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const rows = await api.get<RiskEvent[]>('/admin/risk/events', {
        unresolved_only: unresolvedOnly ? 'true' : undefined,
        limit: 100,
      });
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedOnly]);

  async function resolve(id: string, resolution: (typeof RESOLUTIONS)[number]) {
    setBusy(id);
    try {
      await api.post(`/admin/risk/events/${id}/resolve`, { resolution });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">风控事件</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unresolvedOnly}
            onChange={(e) => setUnresolvedOnly(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          仅未处置
        </label>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>类型</th>
              <th>主体</th>
              <th>severity</th>
              <th>触发时间</th>
              <th>payload</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-500">没有事件</td></tr>}
            {list.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${r.severity >= 70 ? 'bg-red-100 text-red-700' : 'bg-ink-100'}`}>
                    {r.eventType}
                  </span>
                </td>
                <td className="font-mono text-xs">{r.subjectUserId?.slice(0, 8) ?? '—'}…</td>
                <td>{r.severity}</td>
                <td className="text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <details>
                    <summary className="cursor-pointer text-xs text-ink-500">查看</summary>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded bg-ink-50 p-2 text-[10px]">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  </details>
                </td>
                <td className="text-xs">
                  {r.resolvedAt ? <span className="text-ink-500">已处置</span> : <span className="text-primary">未处置</span>}
                </td>
                <td className="text-right">
                  {!r.resolvedAt && (
                    <div className="flex justify-end gap-1">
                      {RESOLUTIONS.map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => void resolve(r.id, res)}
                          disabled={busy === r.id}
                          className={`h-7 rounded-lg px-2 text-[10px] ${
                            res === 'ban' || res === 'suspend' ? 'bg-red-500 text-white' : 'bg-ink-100'
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
