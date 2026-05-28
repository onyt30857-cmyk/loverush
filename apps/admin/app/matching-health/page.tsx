'use client';

/**
 * 派单健康 · 运营总监监控匹配质量
 *
 * 5 块:
 *   ① 漏斗 + DRAFT 滞留警示(草稿 24h+ 未提交 = 客户犹豫信号)
 *   ② 容量警示:active/cooling/suspended 占比 + 总 verified
 *   ③ 响应时长:P50/P95(从下单到支付)
 *   ④ 城市供需比 + Top 30 列表(高比 = 供给不足/低比 = 供给过剩)
 *   ⑤ 技师冷热度 Top 10 vs Bottom 10
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface MatchingHealth {
  range_days: number;
  funnel: {
    DRAFT: number;
    PENDING_CONFIRM: number;
    LOCKED: number;
    PAID: number;
    IN_SERVICE: number;
    COMPLETED: number;
    REVIEWED: number;
    CANCELLED: number;
    DISPUTED: number;
    REFUNDED: number;
    CLOSED: number;
    draft_stale_24h: number;
  };
  city_supply_demand: Array<{ city: string; therapists: number; orders: number; demand_per_therapist: number }>;
  therapist_heat: {
    hot: Array<{ therapist_user_id: string; display_name: string | null; views: number; orders: number }>;
    cold: Array<{ therapist_user_id: string; display_name: string | null; views: number; orders: number }>;
  };
  response_time: { p50_seconds: number | null; p95_seconds: number | null; sample_size: number };
  capacity: { total_verified: number; active: number; cooling: number; suspended: number };
  generated_at: string;
}

const FUNNEL_STEPS = [
  { key: 'DRAFT', label: '草稿', color: 'bg-ink-200' },
  { key: 'PENDING_CONFIRM', label: '待确认', color: 'bg-yellow-300' },
  { key: 'LOCKED', label: '已锁价', color: 'bg-amber-400' },
  { key: 'PAID', label: '已支付', color: 'bg-blue-500' },
  { key: 'IN_SERVICE', label: '服务中', color: 'bg-indigo-500' },
  { key: 'COMPLETED', label: '已完成', color: 'bg-green-500' },
  { key: 'REVIEWED', label: '已评价', color: 'bg-green-600' },
] as const;

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds.toFixed(0)} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分`;
  return `${(seconds / 3600).toFixed(2)} 小时`;
}

export default function MatchingHealthPage() {
  const [data, setData] = useState<MatchingHealth | null>(null);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MatchingHealth>('/admin/matching-health', { range_days: days })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, [days]);

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">派单健康</h1>
          <p className="mt-1 text-xs text-ink-500">
            {data
              ? `${data.range_days} 天窗口 · 更新于 ${new Date(data.generated_at).toLocaleTimeString('zh-CN')}`
              : '加载中…'}
          </p>
        </div>
        <select className="input w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>近 1 天</option>
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {!data ? (
        <div className="text-sm text-ink-500">加载中…</div>
      ) : (
        <>
          {/* DRAFT 滞留警示 */}
          {data.funnel.draft_stale_24h > 0 && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠ <strong className="font-semibold">{data.funnel.draft_stale_24h}</strong> 个客户创建了草稿订单但
              24h+ 未提交。可能是价格/技师选择有犹豫信号 — 考虑短信召回 / 优化技师卡或客服触达。
            </div>
          )}

          {/* ① 订单漏斗 */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">订单漏斗(本期)</h2>
            <div className="card">
              {FUNNEL_STEPS.map((step) => {
                const n = data.funnel[step.key];
                const max = Math.max(...FUNNEL_STEPS.map((s) => data.funnel[s.key]), 1);
                const pct = (n * 100) / max;
                const conv = data.funnel.DRAFT > 0 ? (n * 100) / data.funnel.DRAFT : 0;
                return (
                  <div key={step.key} className="mb-2 last:mb-0">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{step.label}</span>
                      <span className="font-mono text-ink-500">
                        <span className="text-ink-900">{n.toLocaleString()}</span>
                        {data.funnel.DRAFT > 0 && step.key !== 'DRAFT' && (
                          <span className="ml-2 text-ink-400">{conv.toFixed(1)}% from 草稿</span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                      <div className={`h-full ${step.color} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="mt-3 flex gap-6 border-t border-ink-100 pt-3 text-xs text-ink-500">
                <span>取消 <span className="font-mono font-semibold text-ink-900">{data.funnel.CANCELLED}</span></span>
                <span>争议 <span className="font-mono font-semibold text-rose-600">{data.funnel.DISPUTED}</span></span>
                <span>退款 <span className="font-mono font-semibold text-amber-600">{data.funnel.REFUNDED}</span></span>
              </div>
            </div>
          </section>

          {/* ② 容量 + ③ 响应 */}
          <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">技师容量(verified)</h3>
              <div className="mb-3 text-3xl font-bold">{data.capacity.total_verified}</div>
              <div className="space-y-2">
                <CapBar label="active 可派单" value={data.capacity.active} total={data.capacity.total_verified} color="bg-green-500" />
                <CapBar label="cooling 降温中" value={data.capacity.cooling} total={data.capacity.total_verified} color="bg-amber-500" />
                <CapBar label="suspended 暂停" value={data.capacity.suspended} total={data.capacity.total_verified} color="bg-rose-500" />
              </div>
              {data.capacity.total_verified > 0 && data.capacity.active * 2 < data.capacity.total_verified && (
                <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  ⚠ 可派单技师不足总池 50%,推荐池供给偏紧
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">支付响应时长(从下单到支付)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-ink-500">P50 中位数</div>
                  <div className="mt-1 text-2xl font-bold">{fmtDuration(data.response_time.p50_seconds)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-500">P95 长尾</div>
                  <div className="mt-1 text-2xl font-bold">{fmtDuration(data.response_time.p95_seconds)}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-ink-500">
                样本 {data.response_time.sample_size.toLocaleString()} 笔已支付订单
              </div>
            </div>
          </section>

          {/* ④ 城市供需 */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">
              城市供需比
              <span className="ml-2 text-xs font-normal text-ink-400">
                (订单/技师 高 = 供给紧 · 低 = 供给过剩 · 0 = 无下单)
              </span>
            </h2>
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>城市</th>
                    <th className="text-right">技师</th>
                    <th className="text-right">本期订单</th>
                    <th className="text-right">订单/技师</th>
                    <th className="text-right">信号</th>
                  </tr>
                </thead>
                <tbody>
                  {data.city_supply_demand.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-ink-500">
                        尚无城市数据
                      </td>
                    </tr>
                  )}
                  {data.city_supply_demand.map((c) => (
                    <tr key={c.city}>
                      <td>{c.city}</td>
                      <td className="text-right font-mono">{c.therapists}</td>
                      <td className="text-right font-mono">{c.orders}</td>
                      <td className="text-right font-mono">{c.demand_per_therapist}</td>
                      <td className="text-right">
                        {c.demand_per_therapist >= 5 ? (
                          <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                            供给紧 · 招商
                          </span>
                        ) : c.orders === 0 ? (
                          <span className="rounded bg-ink-100 px-2 py-0.5 text-xs">无需求</span>
                        ) : c.demand_per_therapist < 0.5 ? (
                          <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                            供给过剩 · 拉新
                          </span>
                        ) : (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                            健康
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ⑤ 技师冷热度 */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">🔥 热门技师 Top 10</h3>
              <HeatTable rows={data.therapist_heat.hot} />
            </div>
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">
                ❄️ 冷门技师 Bottom 10
                <span className="ml-2 text-xs font-normal text-ink-400">(运营 reach-out 优化资料/曝光)</span>
              </h3>
              <HeatTable rows={data.therapist_heat.cold} />
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}

function CapBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value * 100) / total : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono">
          {value} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HeatTable({
  rows,
}: {
  rows: Array<{ therapist_user_id: string; display_name: string | null; views: number; orders: number }>;
}) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-xs text-ink-400">尚无数据</div>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>技师</th>
          <th className="text-right">浏览</th>
          <th className="text-right">订单</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.therapist_user_id}>
            <td>
              <Link
                href={`/users/therapists/${r.therapist_user_id}`}
                className="text-rose-600 hover:underline"
              >
                {r.display_name ?? r.therapist_user_id.slice(0, 8)}
              </Link>
            </td>
            <td className="text-right font-mono text-xs">{r.views}</td>
            <td className="text-right font-mono text-xs">{r.orders}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
