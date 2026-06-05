'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface RedeemRow {
  id: string;
  holderUserId: string;
  agentUserId: string;
  holderName: string | null;
  agentName: string | null;
  points: number;
  rateBps: number;
  payoutAmount: string;
  payoutCurrency: string;
  payoutMethodType: string;
  payoutMethodFields: Record<string, string>;
  status: string;
  disputeStatus: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  created: '待接单',
  agent_accepted: '处理中',
  agent_paid: '待确认',
  completed: '已完成',
  disputed: '争议',
  cancelled: '已取消',
  expired: '已超时',
};
const STATUS_OPTS = ['', 'disputed', 'created', 'agent_accepted', 'agent_paid', 'completed', 'cancelled', 'expired'];

export default function AdminRedeemPage() {
  const [rows, setRows] = useState<RedeemRow[]>([]);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<RedeemRow | null>(null);

  async function load() {
    try {
      const list = await api.get<RedeemRow[]>('/admin/redeem', status ? { status } : {});
      setRows(list);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function resolve(resolution: 'release_to_agent' | 'refund_holder') {
    if (!resolving || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/redeem/${resolving.id}/resolve`, { resolution });
      setResolving(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">积分回收监控</h1>
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
                <th className="py-1">持有人</th>
                <th>代理</th>
                <th>积分</th>
                <th>应付</th>
                <th>收款方式</th>
                <th>状态</th>
                <th>时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1.5">{r.holderName ?? r.holderUserId.slice(0, 10)}</td>
                  <td>{r.agentName ?? r.agentUserId.slice(0, 10)}</td>
                  <td className="font-medium">{r.points.toLocaleString()}</td>
                  <td>${r.payoutAmount}</td>
                  <td className="text-xs">
                    <div className="font-medium">{r.payoutMethodType}</div>
                    <div className="text-gray-400">
                      {Object.values(r.payoutMethodFields).slice(0, 2).join(' · ')}
                    </div>
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
                  <td colSpan={8} className="py-3 text-center text-gray-400">
                    暂无回收单
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
          <div className="w-[28rem] rounded-lg bg-white p-5">
            <h3 className="mb-2 font-semibold">仲裁回收争议</h3>
            <p className="mb-1 text-sm text-gray-600">
              持有人 {resolving.holderName ?? resolving.holderUserId.slice(0, 10)} 卖回{' '}
              {resolving.points.toLocaleString()} 积分给代理 {resolving.agentName ?? resolving.agentUserId.slice(0, 10)}，
              应付 ${resolving.payoutAmount}。
            </p>
            <div className="mb-3 rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">
              收款方式 {resolving.payoutMethodType}：{Object.entries(resolving.payoutMethodFields).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </div>
            <p className="mb-4 text-xs text-gray-500">
              核对代理付款凭证后裁决：确认代理已付款 → 释放积分给代理；代理未付/无效 → 解冻退回持有人。
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResolving(null)} className="rounded border px-4 py-2 text-sm">
                关闭
              </button>
              <button
                type="button"
                onClick={() => resolve('refund_holder')}
                disabled={busy}
                className="rounded border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 disabled:opacity-50"
              >
                退回持有人
              </button>
              <button
                type="button"
                onClick={() => resolve('release_to_agent')}
                disabled={busy}
                className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                释放给代理
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
