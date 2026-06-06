'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface MethodSnapshot {
  methodType?: string;
  fields?: Record<string, string>;
  country?: string;
}

interface PurchaseRow {
  id: string;
  customerUserId: string;
  agentUserId: string;
  customerName: string | null;
  agentName: string | null;
  points: number;
  localAmount: string | null;
  localCurrency: string | null;
  methodSnapshot: MethodSnapshot | null;
  customerPaidProofUrl: string | null;
  status: string;
  disputeStatus: string | null;
  customerPaidAt: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  created: '待付款',
  customer_paid: '待代理确认',
  points_sent: '已到账',
  disputed: '争议',
  cancelled: '已取消',
  expired: '已超时',
};
const STATUS_OPTS = ['', 'disputed', 'customer_paid', 'created', 'points_sent', 'cancelled', 'expired'];

export default function AdminPurchasesPage() {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [status, setStatus] = useState<string>('disputed');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<PurchaseRow | null>(null);

  async function load() {
    try {
      const list = await api.get<PurchaseRow[]>('/admin/agents/purchases/disputes', status ? { status } : {});
      setRows(list);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function resolve(resolution: 'release_to_customer' | 'reject') {
    if (!resolving || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/agents/purchases/${resolving.id}/resolve`, { resolution });
      setResolving(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  function paidLabel(r: PurchaseRow): string {
    if (r.localAmount) return `${r.localAmount} ${r.localCurrency ?? ''}`.trim();
    return '未填实付';
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">采购仲裁</h1>
            <p className="mt-0.5 text-xs text-gray-400">
              客户付法币给代理后，代理超 72h 未确认放积分会被标为争议。核对客户付款凭证后裁决。
            </p>
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border px-3 py-1.5 text-sm outline-none focus:border-rose-400"
          >
            {STATUS_OPTS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '全部状态' : STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        <section className="rounded-lg border bg-white p-5">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1">客户</th>
                <th>代理</th>
                <th>积分</th>
                <th>客户实付</th>
                <th>收款方式</th>
                <th>凭证</th>
                <th>状态</th>
                <th>时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1.5">{r.customerName ?? r.customerUserId.slice(0, 10)}</td>
                  <td>{r.agentName ?? r.agentUserId.slice(0, 10)}</td>
                  <td className="font-medium">{r.points.toLocaleString()}</td>
                  <td>{paidLabel(r)}</td>
                  <td className="text-xs">
                    <div className="font-medium">{r.methodSnapshot?.methodType ?? '—'}</div>
                    <div className="text-gray-400">
                      {Object.values(r.methodSnapshot?.fields ?? {}).slice(0, 2).join(' · ')}
                    </div>
                  </td>
                  <td className="text-xs">
                    {r.customerPaidProofUrl ? (
                      <a href={r.customerPaidProofUrl} target="_blank" rel="noreferrer" className="text-rose-600 underline">
                        查看
                      </a>
                    ) : (
                      <span className="text-gray-300">无</span>
                    )}
                  </td>
                  <td>
                    <span className={r.status === 'disputed' ? 'font-semibold text-rose-600' : 'text-gray-600'}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="text-right">
                    {r.status === 'disputed' && (
                      <button
                        type="button"
                        onClick={() => setResolving(r)}
                        className="rounded bg-rose-500 px-3 py-1 text-xs font-medium text-white"
                      >
                        仲裁
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-3 text-center text-gray-400">
                    暂无采购单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {/* 仲裁弹窗 */}
      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[30rem] rounded-lg bg-white p-5">
            <h3 className="mb-2 font-semibold">仲裁采购争议</h3>
            <p className="mb-1 text-sm text-gray-600">
              客户 {resolving.customerName ?? resolving.customerUserId.slice(0, 10)} 向代理{' '}
              {resolving.agentName ?? resolving.agentUserId.slice(0, 10)} 购买 {resolving.points.toLocaleString()} 积分，
              客户实付 {paidLabel(resolving)}。
            </p>
            <div className="mb-2 rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">
              收款方式 {resolving.methodSnapshot?.methodType ?? '—'}：
              {Object.entries(resolving.methodSnapshot?.fields ?? {}).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </div>
            {resolving.customerPaidProofUrl && (
              <a
                href={resolving.customerPaidProofUrl}
                target="_blank"
                rel="noreferrer"
                className="mb-3 inline-block text-xs text-rose-600 underline"
              >
                查看客户付款凭证
              </a>
            )}
            <p className="mb-4 text-xs text-gray-500">
              核对客户付款凭证后裁决：确认客户已付款 → 强制放积分给客户（从代理钱包扣）；客户未付/凭证无效 → 驳回。
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResolving(null)} className="rounded border px-4 py-2 text-sm">
                关闭
              </button>
              <button
                type="button"
                onClick={() => resolve('reject')}
                disabled={busy}
                className="rounded border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 disabled:opacity-50"
              >
                驳回
              </button>
              <button
                type="button"
                onClick={() => resolve('release_to_customer')}
                disabled={busy}
                className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                放积分给客户
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
