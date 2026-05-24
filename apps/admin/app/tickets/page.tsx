'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Ticket {
  id: string;
  ticketNo: string;
  category: string;
  priority: number;
  status: string;
  title: string;
  reporterUserId: string;
  targetUserId: string | null;
  relatedOrderId: string | null;
  aiSummary: string | null;
  openedAt: string;
}

export default function TicketsPage() {
  const [list, setList] = useState<Ticket[]>([]);
  const [status, setStatus] = useState('open');
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveType, setResolveType] = useState<'refund' | 'warn_target' | 'suspend_target' | 'ban_target' | 'dismiss'>('dismiss');
  const [note, setNote] = useState('');
  const [refundPoints, setRefundPoints] = useState('');

  async function load() {
    try {
      const rows = await api.get<Ticket[]>('/admin/tickets', { status });
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function resolve() {
    if (!resolving || !note.trim()) return;
    try {
      await api.post(`/admin/tickets/${resolving}/resolve`, {
        resolution_type: resolveType,
        resolution_note: note,
        refund_points: resolveType === 'refund' && refundPoints ? Number(refundPoints) : undefined,
      });
      setResolving(null);
      setNote('');
      setRefundPoints('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">客服工单</h1>
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">open</option>
          <option value="triage">triage</option>
          <option value="assigned">assigned</option>
          <option value="in_review">in_review</option>
          <option value="waiting_user">waiting_user</option>
          <option value="resolved">resolved</option>
          <option value="closed">closed</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>编号</th>
              <th>分类</th>
              <th>优先级</th>
              <th>标题</th>
              <th>AI 摘要</th>
              <th>关联订单</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-500">暂无</td></tr>}
            {list.map((t) => (
              <tr key={t.id}>
                <td className="font-mono text-xs">{t.ticketNo}</td>
                <td><span className="rounded bg-ink-100 px-2 py-0.5 text-xs">{t.category}</span></td>
                <td>{t.priority}</td>
                <td className="max-w-[200px] truncate">{t.title}</td>
                <td className="max-w-[260px] truncate text-xs text-ink-500">{t.aiSummary ?? '—'}</td>
                <td className="font-mono text-xs">{t.relatedOrderId ? `${t.relatedOrderId.slice(0, 8)}…` : '—'}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => setResolving(t.id)}
                    className="btn-primary h-7 px-3 text-xs"
                  >
                    裁决
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-md">
            <h3 className="text-base font-semibold">裁决工单</h3>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 text-xs">处置类型</div>
                <select className="input w-full" value={resolveType} onChange={(e) => setResolveType(e.target.value as never)}>
                  <option value="dismiss">不予处理</option>
                  <option value="refund">退款</option>
                  <option value="warn_target">警告</option>
                  <option value="suspend_target">暂停</option>
                  <option value="ban_target">封号</option>
                </select>
              </div>
              {resolveType === 'refund' && (
                <input
                  className="input w-full"
                  type="number"
                  placeholder="退款积分"
                  value={refundPoints}
                  onChange={(e) => setRefundPoints(e.target.value)}
                />
              )}
              <textarea
                className="h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
                placeholder="处置说明（用户可见）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setResolving(null);
                  setNote('');
                  setRefundPoints('');
                }}
                className="btn-ghost flex-1"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void resolve()}
                disabled={!note.trim()}
                className="btn-primary flex-1"
              >
                确认裁决
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
