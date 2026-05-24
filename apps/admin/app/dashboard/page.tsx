'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api } from '@/lib/api';

interface Dashboard {
  activity?: { dau: number; wau: number; mau: number };
  funnel?: Array<{ status: string; cnt: number }>;
  gmv?: { gmv_points: string };
  refund_dispute?: { completed: number; refunded: number; disputed: number };
  user_distribution?: Array<{ user_type: string; cnt: number }>;
  city_distribution?: Array<{ city: string; therapist_count: number }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    api.get<Dashboard>('/admin/dashboard', { range_days: days }).then(setData).catch(() => setData(null));
  }, [days]);

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">运营总览</h1>
        <select
          className="input w-32"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={1}>近 1 天</option>
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={90}>近 90 天</option>
        </select>
      </div>

      {!data ? (
        <div className="text-sm text-ink-500">加载中…</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="DAU" value={data.activity?.dau ?? 0} />
            <Stat label="WAU" value={data.activity?.wau ?? 0} />
            <Stat label="MAU" value={data.activity?.mau ?? 0} />
            <Stat label="GMV (积分)" value={parseInt(data.gmv?.gmv_points ?? '0', 10).toLocaleString()} />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">订单漏斗</h3>
              <table className="table">
                <thead><tr><th>状态</th><th className="text-right">数量</th></tr></thead>
                <tbody>
                  {(data.funnel ?? []).map((f) => (
                    <tr key={f.status}>
                      <td>{f.status}</td>
                      <td className="text-right font-mono">{f.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">退款 / 争议比</h3>
              <div className="space-y-2 text-sm">
                <Row label="已完成" value={data.refund_dispute?.completed ?? 0} />
                <Row label="退款" value={data.refund_dispute?.refunded ?? 0} />
                <Row label="争议中" value={data.refund_dispute?.disputed ?? 0} />
              </div>
            </div>

            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">用户分布</h3>
              <table className="table">
                <thead><tr><th>类型</th><th className="text-right">数量</th></tr></thead>
                <tbody>
                  {(data.user_distribution ?? []).map((u) => (
                    <tr key={u.user_type}><td>{u.user_type}</td><td className="text-right font-mono">{u.cnt}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">城市分布（Top）</h3>
              <table className="table">
                <thead><tr><th>城市</th><th className="text-right">技师数</th></tr></thead>
                <tbody>
                  {(data.city_distribution ?? []).slice(0, 10).map((c) => (
                    <tr key={c.city}><td>{c.city}</td><td className="text-right font-mono">{c.therapist_count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-ink-500">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
