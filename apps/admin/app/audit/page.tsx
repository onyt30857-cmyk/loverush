'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface AuditRow {
  id: string;
  targetType: string;
  targetUserId: string;
  status: string;
  priority: number;
  snapshot: Record<string, unknown>;
  submittedAt: string;
}

export default function AuditPage() {
  const [list, setList] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function load() {
    try {
      const rows = await api.get<AuditRow[]>('/admin/audit/queue', { status: 'pending', limit: 100 });
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(id: string) {
    setBusy(id);
    try {
      await api.post(`/admin/audit/${id}/approve`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!rejectingId || !rejectReason.trim()) return;
    setBusy(rejectingId);
    try {
      await api.post(`/admin/audit/${rejectingId}/reject`, { reason: rejectReason });
      setRejectingId(null);
      setRejectReason('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <h1 className="mb-6 text-2xl font-bold">审核队列</h1>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>目标类型</th>
              <th>用户</th>
              <th>优先级</th>
              <th>提交时间</th>
              <th>预览</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-ink-500">暂无待审</td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id}>
                <td><span className="rounded bg-ink-100 px-2 py-0.5 text-xs">{r.targetType}</span></td>
                <td className="font-mono text-xs">{r.targetUserId.slice(0, 8)}…</td>
                <td>{r.priority}</td>
                <td className="text-xs">{new Date(r.submittedAt).toLocaleString()}</td>
                <td>
                  <details>
                    <summary className="cursor-pointer text-xs text-ink-500">查看</summary>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded bg-ink-50 p-2 text-[10px]">
                      {JSON.stringify(r.snapshot, null, 2)}
                    </pre>
                  </details>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => void approve(r.id)}
                    disabled={busy === r.id}
                    className="btn-primary mr-2 h-7 px-3 text-xs"
                  >
                    通过
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(r.id)}
                    className="btn-danger h-7 px-3 text-xs"
                  >
                    拒绝
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-md">
            <h3 className="text-base font-semibold">拒绝原因</h3>
            <textarea
              className="mt-3 h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
              placeholder="说明为什么拒绝（用户可见）"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setRejectingId(null);
                  setRejectReason('');
                }}
                className="btn-ghost flex-1"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void reject()}
                disabled={!rejectReason.trim() || busy === rejectingId}
                className="btn-danger flex-1"
              >
                确认拒绝
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
