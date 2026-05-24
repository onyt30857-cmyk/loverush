'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Withdrawal {
  id: string;
  therapistUserId: string;
  amountCents: number;
  currency: string;
  method: string;
  status: string;
  payoutDetailsEncrypted: string | null;
  requestedAt: string;
  rejectReason: string | null;
  externalTxnRef: string | null;
  paidAt: string | null;
}

export default function WithdrawalsPage() {
  const [list, setList] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState<'pending' | 'processing' | 'paid' | 'rejected' | 'cancelled'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approving, setApproving] = useState<Withdrawal | null>(null);
  const [rejecting, setRejecting] = useState<Withdrawal | null>(null);
  const [externalRef, setExternalRef] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    try {
      const rows = await api.get<Withdrawal[]>('/admin/withdrawals', { status, limit: 100 });
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function approve() {
    if (!approving || !externalRef) return;
    setBusy(approving.id);
    try {
      await api.post(`/admin/withdrawals/${approving.id}/approve`, { external_txn_ref: externalRef });
      setApproving(null);
      setExternalRef('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!rejecting || !reason) return;
    setBusy(rejecting.id);
    try {
      await api.post(`/admin/withdrawals/${rejecting.id}/reject`, { reason });
      setRejecting(null);
      setReason('');
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
        <h1 className="text-2xl font-bold">提现审批</h1>
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="pending">pending</option>
          <option value="processing">processing</option>
          <option value="paid">paid</option>
          <option value="rejected">rejected</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>请求时间</th>
              <th>技师</th>
              <th>金额 (USD)</th>
              <th>方式</th>
              <th>账号</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-ink-500">没有 {status} 状态的提现</td></tr>
            )}
            {list.map((w) => (
              <tr key={w.id}>
                <td className="text-xs">{new Date(w.requestedAt).toLocaleString()}</td>
                <td className="font-mono text-xs">{w.therapistUserId.slice(0, 8)}…</td>
                <td className="font-mono">${(w.amountCents / 100).toFixed(2)}</td>
                <td><span className="rounded bg-ink-100 px-2 py-0.5 text-xs uppercase">{w.method}</span></td>
                <td className="max-w-[200px] truncate font-mono text-xs">{w.payoutDetailsEncrypted}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    w.status === 'paid' ? 'bg-green-100 text-green-700' :
                    w.status === 'rejected' ? 'bg-red-100 text-red-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {w.status}
                  </span>
                </td>
                <td className="text-right">
                  {w.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setApproving(w)}
                        disabled={busy === w.id}
                        className="btn-primary mr-2 h-7 px-3 text-xs"
                      >
                        批准
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(w)}
                        className="btn-danger h-7 px-3 text-xs"
                      >
                        拒绝
                      </button>
                    </>
                  )}
                  {w.status === 'paid' && w.externalTxnRef && (
                    <span className="font-mono text-xs text-ink-500">{w.externalTxnRef.slice(0, 20)}</span>
                  )}
                  {w.status === 'rejected' && w.rejectReason && (
                    <span className="text-xs text-ink-500">{w.rejectReason.slice(0, 30)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {approving && (
        <Modal title={`批准提现 $${(approving.amountCents / 100).toFixed(2)}`} onClose={() => setApproving(null)}>
          <div className="mb-2 text-xs text-ink-500">
            {approving.method.toUpperCase()} · {approving.payoutDetailsEncrypted}
          </div>
          <input
            className="input w-full"
            placeholder="外部打款 ref（Wise / Stripe / USDT txn id）"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
          />
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setApproving(null)} className="btn-ghost flex-1">取消</button>
            <button
              type="button"
              onClick={() => void approve()}
              disabled={!externalRef || busy === approving.id}
              className="btn-primary flex-1"
            >
              确认批准
            </button>
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal title="拒绝提现" onClose={() => setRejecting(null)}>
          <div className="mb-2 text-xs text-ink-500">
            ${(rejecting.amountCents / 100).toFixed(2)} · {rejecting.method.toUpperCase()}
          </div>
          <textarea
            className="h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
            placeholder="拒绝原因（用户可见，会解冻金额回账）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setRejecting(null)} className="btn-ghost flex-1">取消</button>
            <button
              type="button"
              onClick={() => void reject()}
              disabled={!reason || busy === rejecting.id}
              className="btn-danger flex-1"
            >
              确认拒绝
            </button>
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="card w-full max-w-md">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-ink-300">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
