'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface AgentProfile {
  userId: string;
  status: string;
  serviceCountries: string[];
  serviceCities: string[];
  totalWholesalePoints: number;
  totalSoldPoints: number;
}
interface WholesaleOrder {
  id: string;
  agentUserId: string;
  points: number;
  usdFaceCents: number;
  usdtAmountCents: number;
  status: string;
  createdAt: string;
}

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [wholesale, setWholesale] = useState<WholesaleOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 授予表单
  const [grantUserId, setGrantUserId] = useState('');
  const [grantCountries, setGrantCountries] = useState('TH');
  // 确认批发
  const [confirming, setConfirming] = useState<WholesaleOrder | null>(null);
  const [txnRef, setTxnRef] = useState('');

  async function load() {
    try {
      const [ag, ws] = await Promise.all([
        api.get<AgentProfile[]>('/admin/agents'),
        api.get<WholesaleOrder[]>('/admin/agents/wholesale', { status: 'pending' }),
      ]);
      setAgents(ag);
      setWholesale(ws);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function grant() {
    if (!grantUserId.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const countries = grantCountries
        .split(/[,，\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      await api.post(`/admin/agents/${grantUserId.trim()}/grant`, { service_countries: countries });
      setGrantUserId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function confirmWholesale() {
    if (!confirming || !txnRef.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/agents/wholesale/${confirming.id}/confirm`, { usdt_txn_ref: txnRef.trim() });
      setConfirming(null);
      setTxnRef('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-4xl space-y-8 p-6">
        <h1 className="text-xl font-bold">积分代理管理</h1>
        {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        {/* 授予代理 */}
        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 font-semibold">授予代理身份</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-500">用户 ID</span>
              <input
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
                placeholder="目标用户 UUID"
                className="w-80 rounded border px-3 py-2 text-sm outline-none focus:border-rose-400"
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-500">服务国家（逗号分隔）</span>
              <input
                value={grantCountries}
                onChange={(e) => setGrantCountries(e.target.value)}
                placeholder="TH, MY"
                className="w-40 rounded border px-3 py-2 text-sm outline-none focus:border-rose-400"
              />
            </label>
            <button
              type="button"
              onClick={grant}
              disabled={busy || !grantUserId.trim()}
              className="rounded bg-rose-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              授予
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-sm font-medium text-gray-600">现有代理（{agents.length}）</div>
            <table className="w-full text-left text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="py-1">用户 ID</th>
                  <th>状态</th>
                  <th>国家</th>
                  <th>累计批发</th>
                  <th>累计售出</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.userId} className="border-t">
                    <td className="py-1.5 font-mono text-xs">{a.userId.slice(0, 18)}…</td>
                    <td>{a.status}</td>
                    <td>{(a.serviceCountries ?? []).join(', ')}</td>
                    <td>{a.totalWholesalePoints.toLocaleString()}</td>
                    <td>{a.totalSoldPoints.toLocaleString()}</td>
                  </tr>
                ))}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-gray-400">
                      暂无代理
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 待确认批发单 */}
        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 font-semibold">
            待确认 USDT 批发 {wholesale.length > 0 && <span className="text-rose-500">({wholesale.length})</span>}
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1">代理</th>
                <th>积分</th>
                <th>面值</th>
                <th>应收 USDT</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wholesale.map((w) => (
                <tr key={w.id} className="border-t">
                  <td className="py-1.5 font-mono text-xs">{w.agentUserId.slice(0, 18)}…</td>
                  <td>{w.points.toLocaleString()}</td>
                  <td>${(w.usdFaceCents / 100).toFixed(2)}</td>
                  <td className="font-medium">{(w.usdtAmountCents / 100).toFixed(2)} USDT</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(w);
                        setTxnRef('');
                      }}
                      className="rounded bg-emerald-500 px-3 py-1 text-xs font-medium text-white"
                    >
                      确认到账
                    </button>
                  </td>
                </tr>
              ))}
              {wholesale.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-gray-400">
                    暂无待确认批发单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      {/* 确认批发弹窗 */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-white p-5">
            <h3 className="mb-2 font-semibold">确认 USDT 到账</h3>
            <p className="mb-3 text-sm text-gray-500">
              代理 {confirming.agentUserId.slice(0, 12)}… · {confirming.points.toLocaleString()} 积分 · 应收{' '}
              {(confirming.usdtAmountCents / 100).toFixed(2)} USDT
            </p>
            <input
              value={txnRef}
              onChange={(e) => setTxnRef(e.target.value)}
              placeholder="USDT 链上交易哈希 / 流水号"
              className="w-full rounded border px-3 py-2 text-sm outline-none focus:border-rose-400"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} className="rounded border px-4 py-2 text-sm">
                取消
              </button>
              <button
                type="button"
                onClick={confirmWholesale}
                disabled={busy || !txnRef.trim()}
                className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                确认入账
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
