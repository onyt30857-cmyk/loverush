'use client';

/**
 * AI 成本看板 · 防止 AI 费用失控
 *
 * 关键 ROI 指标:GMV 积分($) / AI 成本($)
 *   >= 1.0 健康 · 每花 1 美元 AI 至少带来 1 美元 GMV
 *   < 1.0 警示 · AI 在烧钱不赚钱(或新技师冷启动期)
 *   N/A   无消费 · AI 全免单(陪聊免费 / 无 GMV)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface CostOverview {
  range_days: number;
  totals: {
    msg_count: number;
    msg_count_prev: number;
    cost_usd: number;
    cost_usd_prev: number;
    input_tokens: number;
    output_tokens: number;
  };
  by_model: Array<{
    provider: string;
    model: string;
    msg_count: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  by_scenario: Array<{
    scenario: string;
    msg_count: number;
    cost_usd: number;
    avg_cost_usd: number;
  }>;
  top_spenders: Array<{
    therapist_user_id: string;
    display_name: string | null;
    ai_msg_count: number;
    ai_cost_usd: number;
    gmv_points: number;
    paid_orders: number;
    roi: number | null;
  }>;
  generated_at: string;
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) * 100) / prev;
}

export default function AiCostPage() {
  const [data, setData] = useState<CostOverview | null>(null);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CostOverview>('/admin/ai/cost/overview', { range_days: days })
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, [days]);

  if (error) {
    return (
      <AdminShell>
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      </AdminShell>
    );
  }

  if (!data) {
    return (
      <AdminShell>
        <div className="text-sm text-ink-500">加载中…</div>
      </AdminShell>
    );
  }

  const costDelta = pctDelta(data.totals.cost_usd, data.totals.cost_usd_prev);
  const dailyAvg = data.totals.cost_usd / days;

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI 成本看板</h1>
          <p className="mt-1 text-xs text-ink-500">
            AI 分身 cost_usd_micros 实时聚合 · 防费用失控
          </p>
        </div>
        <select className="input w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>近 1 天</option>
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
        </select>
      </div>

      {/* 顶层 KPI */}
      <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label={`本期总成本(${days}d)`}
          value={`$${data.totals.cost_usd.toFixed(4)}`}
          delta={costDelta}
          accent
        />
        <Kpi label="日均" value={`$${dailyAvg.toFixed(4)}`} sub={`${days} 天均摊`} />
        <Kpi
          label="代发条数"
          value={data.totals.msg_count.toLocaleString()}
          delta={pctDelta(data.totals.msg_count, data.totals.msg_count_prev)}
        />
        <Kpi
          label="平均单条成本"
          value={
            data.totals.msg_count > 0
              ? `$${(data.totals.cost_usd / data.totals.msg_count).toFixed(5)}`
              : '—'
          }
          sub={`${(data.totals.input_tokens + data.totals.output_tokens).toLocaleString()} tokens`}
        />
      </section>

      {/* 按模型 */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">provider × model 成本拆分</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>provider</th>
                <th>model</th>
                <th className="text-right">条数</th>
                <th className="text-right">总成本</th>
                <th className="text-right">单条均价</th>
                <th className="text-right">输入 tok</th>
                <th className="text-right">输出 tok</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              {data.by_model.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-ink-500">
                    本期无 AI 代发记录
                  </td>
                </tr>
              )}
              {data.by_model.map((m) => {
                const pct = data.totals.cost_usd > 0 ? (m.cost_usd * 100) / data.totals.cost_usd : 0;
                return (
                  <tr key={`${m.provider}-${m.model}`}>
                    <td className="text-xs">{m.provider}</td>
                    <td className="font-mono text-xs">{m.model}</td>
                    <td className="text-right font-mono">{m.msg_count.toLocaleString()}</td>
                    <td className="text-right font-mono font-semibold">${m.cost_usd.toFixed(4)}</td>
                    <td className="text-right font-mono text-xs">
                      ${(m.cost_usd / Math.max(m.msg_count, 1)).toFixed(5)}
                    </td>
                    <td className="text-right font-mono text-xs">{m.input_tokens.toLocaleString()}</td>
                    <td className="text-right font-mono text-xs">{m.output_tokens.toLocaleString()}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                          <div className="h-full bg-rose-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-12 text-right text-xs">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 按场景 */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-700">scenario 场景拆分(找出 ROI 最差场景)</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>scenario</th>
                <th className="text-right">条数</th>
                <th className="text-right">总成本</th>
                <th className="text-right">平均单条成本</th>
              </tr>
            </thead>
            <tbody>
              {data.by_scenario.map((s) => (
                <tr key={s.scenario}>
                  <td className="font-mono text-xs">{s.scenario}</td>
                  <td className="text-right font-mono">{s.msg_count.toLocaleString()}</td>
                  <td className="text-right font-mono font-semibold">${s.cost_usd.toFixed(4)}</td>
                  <td className="text-right font-mono text-xs">${s.avg_cost_usd.toFixed(5)}</td>
                </tr>
              ))}
              {data.by_scenario.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink-500">
                    无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top spenders + ROI */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-700">
          单技师 AI 成本 vs GMV(Top 20)
          <span className="ml-2 text-xs font-normal text-ink-400">
            ROI &lt; 1.0 = 烧钱不赚钱 · &gt;= 1.0 健康 · N/A = 无 GMV
          </span>
        </h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>技师</th>
                <th className="text-right">AI 条数</th>
                <th className="text-right">AI 成本</th>
                <th className="text-right">本期 GMV(积分)</th>
                <th className="text-right">支付订单</th>
                <th className="text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {data.top_spenders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-500">
                    本期无 AI 消费技师
                  </td>
                </tr>
              )}
              {data.top_spenders.map((r) => (
                <tr key={r.therapist_user_id}>
                  <td>
                    <Link
                      href={`/users/therapists/${r.therapist_user_id}`}
                      className="text-rose-600 hover:underline"
                    >
                      {r.display_name ?? r.therapist_user_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="text-right font-mono">{r.ai_msg_count.toLocaleString()}</td>
                  <td className="text-right font-mono font-semibold">${r.ai_cost_usd.toFixed(4)}</td>
                  <td className="text-right font-mono">{r.gmv_points.toLocaleString()}</td>
                  <td className="text-right font-mono">{r.paid_orders}</td>
                  <td className="text-right">
                    {r.roi === null ? (
                      <span className="font-mono text-xs text-ink-400">N/A</span>
                    ) : (
                      <span
                        className={`font-mono font-semibold ${
                          r.roi >= 1 ? 'text-green-600' : 'text-rose-600'
                        }`}
                      >
                        {r.roi.toFixed(2)}×
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  accent?: boolean;
}) {
  const showDelta = delta !== undefined;
  const isPos = (delta ?? 0) >= 0;
  return (
    <div className={`card ${accent ? 'bg-gradient-to-br from-rose-50 to-white' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-rose-700' : 'text-ink-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
      {showDelta && (
        <div
          className={`mt-1 text-xs font-medium ${
            delta === null ? 'text-ink-400' : isPos ? 'text-rose-600' : 'text-green-600'
          }`}
        >
          {delta === null
            ? 'NEW(上期 0)'
            : `${isPos ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}% vs 上期(${isPos ? '注意花费上升' : '已节约'})`}
        </div>
      )}
    </div>
  );
}
