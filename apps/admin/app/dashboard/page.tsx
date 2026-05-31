'use client';

/**
 * 运营总览(P1 升级)· 资深运营总监视角
 *
 * 阅读顺序(从最紧急到最宏观):
 *   ① 警报横幅 — 待处理工单/审核/KYC/提现/批发/争议/风控,全部带 deep link
 *   ② 增长 KPI — DAU/WAU/MAU + GMV + 新增用户 + WoW 对比
 *   ③ 注册漏斗 — 本期注册客户 → 下单 → 支付 → 完成 → 评价 转化率
 *   ④ 留存 — D1/D7/D30 同期 cohort 留存
 *   ⑤ 订单/退款/分布 — 原版保留
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api } from '@/lib/api';

interface Dashboard {
  range_days?: number;
  activity?: { dau: number; wau: number; mau: number };
  funnel?: Array<{ status: string; cnt: number }>;
  gmv?: {
    gmv_points: string;
    gmv_points_prev: string;
    paid_orders: number;
    paid_orders_prev: number;
  };
  refund_dispute?: { completed: number; refunded: number; disputed: number };
  user_distribution?: Array<{ user_type: string; cnt: number }>;
  city_distribution?: Array<{ city: string; therapist_count: number }>;
  new_users?: Array<{ user_type: string; curr: number; prev: number }>;
  signup_funnel?: {
    registered: number;
    created_order: number;
    paid_order: number;
    completed_order: number;
    reviewed_order: number;
  };
  retention?: { cohort_size: number; d1_active: number; d7_active: number; d30_active: number };
  alerts?: {
    open_tickets: number;
    pending_audits: number;
    pending_verifications: number;
    pending_withdrawals: number;
    pending_wholesale: number;
    disputed_orders: number;
    unresolved_risk: number;
  };
}

const ALERT_DEFS: Array<{
  key: keyof NonNullable<Dashboard['alerts']>;
  label: string;
  href: string;
  icon: string;
}> = [
  { key: 'disputed_orders', label: '订单争议', href: '/orders?status=DISPUTED', icon: '⚖️' },
  { key: 'pending_verifications', label: '待真人核验', href: '/verifications', icon: '💎' },
  { key: 'pending_audits', label: '待审工单', href: '/audit', icon: '✅' },
  { key: 'pending_withdrawals', label: '待审提现', href: '/withdrawals', icon: '💸' },
  { key: 'pending_wholesale', label: '待确认 USDT 批发', href: '/agents', icon: '🪙' },
  { key: 'open_tickets', label: '开放工单', href: '/tickets', icon: '🎫' },
  { key: 'unresolved_risk', label: '未处理风控', href: '/risk', icon: '🛡' },
];

const USER_TYPE_LABEL: Record<string, string> = {
  customer: '客户',
  therapist: '技师',
  agent: '代理',
  admin: '管理',
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    api.get<Dashboard>('/admin/dashboard', { range_days: days }).then(setData).catch(() => setData(null));
  }, [days]);

  const totalAlerts =
    data?.alerts
      ? ALERT_DEFS.reduce((sum, def) => sum + (data.alerts?.[def.key] ?? 0), 0)
      : 0;

  const gmv = data?.gmv ? parseInt(data.gmv.gmv_points, 10) : 0;
  const gmvPrev = data?.gmv ? parseInt(data.gmv.gmv_points_prev, 10) : 0;
  const gmvDelta = pctDelta(gmv, gmvPrev);
  const ordersDelta = pctDelta(data?.gmv?.paid_orders ?? 0, data?.gmv?.paid_orders_prev ?? 0);

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">运营总览</h1>
          <p className="mt-1 text-xs text-ink-500">
            {data ? `${data.range_days} 天窗口 · 对比上一同期` : '加载中…'}
          </p>
        </div>
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
          {/* ① 警报横幅 */}
          {totalAlerts > 0 ? (
            <section className="mb-6">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-700">
                <span>🚨 待处理 ({totalAlerts})</span>
                <span className="text-xs font-normal text-ink-400">点卡片直接跳到处理页</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                {ALERT_DEFS.map((def) => {
                  const n = data.alerts?.[def.key] ?? 0;
                  return (
                    <a
                      key={def.key}
                      href={def.href}
                      className={`group flex flex-col rounded-lg border px-3 py-2.5 transition hover:shadow-md ${
                        n > 0
                          ? 'border-rose-200 bg-rose-50 hover:border-rose-400'
                          : 'border-ink-100 bg-white hover:border-ink-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-base">{def.icon}</span>
                        <span
                          className={`text-lg font-bold ${
                            n > 0 ? 'text-rose-600' : 'text-ink-300'
                          }`}
                        >
                          {n}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-ink-500 group-hover:text-ink-700">
                        {def.label}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              🎉 当前无待处理事项 · 队列零积压
            </section>
          )}

          {/* ② 增长 KPI */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">增长 · 核心 KPI</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KPI label="DAU" value={data.activity?.dau ?? 0} />
              <KPI label="WAU" value={data.activity?.wau ?? 0} />
              <KPI label="MAU" value={data.activity?.mau ?? 0} />
              <KPI
                label="GMV (积分)"
                value={gmv.toLocaleString()}
                delta={gmvDelta}
                accent
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <KPI
                label="本期支付订单"
                value={(data.gmv?.paid_orders ?? 0).toLocaleString()}
                delta={ordersDelta}
              />
              {(data.new_users ?? []).map((u) => (
                <KPI
                  key={u.user_type}
                  label={`新增 · ${USER_TYPE_LABEL[u.user_type] ?? u.user_type}`}
                  value={u.curr.toLocaleString()}
                  delta={pctDelta(u.curr, u.prev)}
                />
              ))}
            </div>
          </section>

          {/* M02b/M04 Phase 1 · 节目监控 KPI */}
          <ShowsKpiSection />

          {/* ③ 注册漏斗 */}
          {data.signup_funnel && data.signup_funnel.registered > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-ink-700">
                客户注册转化漏斗
                <span className="ml-2 text-xs font-normal text-ink-400">
                  (本期注册 {data.signup_funnel.registered} 客户)
                </span>
              </h2>
              <div className="card">
                <FunnelStep label="注册" value={data.signup_funnel.registered} total={data.signup_funnel.registered} />
                <FunnelStep label="创建订单" value={data.signup_funnel.created_order} total={data.signup_funnel.registered} />
                <FunnelStep label="支付订单" value={data.signup_funnel.paid_order} total={data.signup_funnel.registered} />
                <FunnelStep label="完成服务" value={data.signup_funnel.completed_order} total={data.signup_funnel.registered} />
                <FunnelStep label="完成评价" value={data.signup_funnel.reviewed_order} total={data.signup_funnel.registered} />
              </div>
            </section>
          )}

          {/* ④ 留存 */}
          {data.retention && data.retention.cohort_size > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-ink-700">
                同期 cohort 留存
                <span className="ml-2 text-xs font-normal text-ink-400">
                  ({data.retention.cohort_size} 用户基数 · 注册后 N 天回访 = 有事件)
                </span>
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <RetCard label="D1 留存" active={data.retention.d1_active} total={data.retention.cohort_size} />
                <RetCard label="D7 留存" active={data.retention.d7_active} total={data.retention.cohort_size} />
                <RetCard label="D30 留存" active={data.retention.d30_active} total={data.retention.cohort_size} />
              </div>
            </section>
          )}

          {/* ⑤ 订单 / 退款 / 分布 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-700">订单 / 退款 / 分布</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="card">
                <h3 className="mb-3 text-sm font-semibold">订单漏斗 · 按状态</h3>
                <table className="table">
                  <thead><tr><th>状态</th><th className="text-right">数量</th></tr></thead>
                  <tbody>
                    {(data.funnel ?? []).map((f) => (
                      <tr key={f.status}>
                        <td>{f.status}</td>
                        <td className="text-right font-mono">{f.cnt}</td>
                      </tr>
                    ))}
                    {(data.funnel ?? []).length === 0 && (
                      <tr><td colSpan={2} className="py-4 text-center text-xs text-ink-400">本期无订单</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <h3 className="mb-3 text-sm font-semibold">退款 / 争议比</h3>
                <div className="space-y-2 text-sm">
                  <Row label="已完成" value={data.refund_dispute?.completed ?? 0} />
                  <Row label="退款" value={data.refund_dispute?.refunded ?? 0} />
                  <Row label="争议中" value={data.refund_dispute?.disputed ?? 0} />
                  {(data.refund_dispute?.completed ?? 0) > 0 && (
                    <div className="border-t border-ink-100 pt-2 text-xs text-ink-500">
                      退款率{' '}
                      <span className="font-mono font-semibold">
                        {(((data.refund_dispute?.refunded ?? 0) * 100) / (data.refund_dispute?.completed ?? 1)).toFixed(2)}%
                      </span>
                      {' · '}
                      争议率{' '}
                      <span className="font-mono font-semibold">
                        {(((data.refund_dispute?.disputed ?? 0) * 100) / (data.refund_dispute?.completed ?? 1)).toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <h3 className="mb-3 text-sm font-semibold">用户分布(累计)</h3>
                <table className="table">
                  <thead><tr><th>类型</th><th className="text-right">数量</th></tr></thead>
                  <tbody>
                    {(data.user_distribution ?? []).map((u) => (
                      <tr key={u.user_type}>
                        <td>{USER_TYPE_LABEL[u.user_type] ?? u.user_type}</td>
                        <td className="text-right font-mono">{u.cnt.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <h3 className="mb-3 text-sm font-semibold">城市分布 Top 10</h3>
                <table className="table">
                  <thead><tr><th>城市</th><th className="text-right">技师数</th></tr></thead>
                  <tbody>
                    {(data.city_distribution ?? []).slice(0, 10).map((c) => (
                      <tr key={c.city}>
                        <td>{c.city}</td>
                        <td className="text-right font-mono">{c.therapist_count}</td>
                      </tr>
                    ))}
                    {(data.city_distribution ?? []).length === 0 && (
                      <tr><td colSpan={2} className="py-4 text-center text-xs text-ink-400">尚无技师设置城市</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null; // 上期 0,本期非 0,delta 无意义(显示 NEW)
  return ((curr - prev) * 100) / prev;
}

function KPI({
  label,
  value,
  delta,
  accent,
}: {
  label: string;
  value: number | string;
  delta?: number | null;
  accent?: boolean;
}) {
  const showDelta = delta !== undefined;
  const isPos = (delta ?? 0) >= 0;
  return (
    <div className={`card ${accent ? 'bg-gradient-to-br from-rose-50 to-white' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-rose-700' : 'text-ink-900'}`}>{value}</div>
      {showDelta && (
        <div
          className={`mt-1 text-xs font-medium ${
            delta === null ? 'text-ink-400' : isPos ? 'text-green-600' : 'text-rose-600'
          }`}
        >
          {delta === null ? 'NEW (上期 0)' : `${isPos ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}% vs 上期`}
        </div>
      )}
    </div>
  );
}

function FunnelStep({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? (value * 100) / total : 0;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-ink-500">
          <span className="font-mono font-semibold text-ink-900">{value.toLocaleString()}</span>
          <span className="ml-2 text-ink-400">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RetCard({ label, active, total }: { label: string; active: number; total: number }) {
  const pct = total > 0 ? (active * 100) / total : 0;
  const color =
    pct >= 30 ? 'text-green-700 bg-green-50' : pct >= 10 ? 'text-amber-700 bg-amber-50' : 'text-rose-700 bg-rose-50';
  return (
    <div className={`card ${color}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold">{pct.toFixed(1)}%</div>
      <div className="mt-0.5 text-xs opacity-70">
        {active.toLocaleString()} / {total.toLocaleString()}
      </div>
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

// M02b/M04 Phase 1 · 节目监控 KPI section · 自拉 /admin/shows 算 4 维
interface ShowMini {
  id: string;
  status: string;
  start_time: string;
  slots_total: number;
  slots_remaining: number;
}

function ShowsKpiSection() {
  const [shows, setShows] = useState<ShowMini[]>([]);
  useEffect(() => {
    api.get<ShowMini[]>('/admin/shows', { limit: 200 }).then(setShows).catch(() => setShows([]));
  }, []);

  const now = new Date();
  const tomorrowEnd = new Date(now.getTime() + 24 * 3600 * 1000);
  const openTonight = shows.filter((s) => {
    if (s.status !== 'open') return false;
    const t = new Date(s.start_time).getTime();
    return t >= now.getTime() && t <= tomorrowEnd.getTime();
  });
  const totalSold = shows.reduce((sum, s) => sum + (s.slots_total - s.slots_remaining), 0);
  const totalSlots = shows.reduce((sum, s) => sum + s.slots_total, 0);
  const soldOutRate = totalSlots > 0 ? Math.round((totalSold / totalSlots) * 100) : 0;
  const drafts = shows.filter((s) => s.status === 'draft').length;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-ink-700">
        节目监控
        <a href="/admin/shows" className="ml-2 text-xs font-normal text-blue-600 hover:underline">查看全部 →</a>
      </h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-ink-500">今晚 open 节目</div>
          <div className="mt-1 text-2xl font-bold text-green-700">{openTonight.length}</div>
          <div className="mt-0.5 text-[10px] text-ink-400">未来 24h · 可被拍单</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-ink-500">累计销量</div>
          <div className="mt-1 text-2xl font-bold text-ink-800">{totalSold}</div>
          <div className="mt-0.5 text-[10px] text-ink-400">已拍 / 已扣 slots</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-ink-500">平均售罄率</div>
          <div className="mt-1 text-2xl font-bold text-primary">{soldOutRate}%</div>
          <div className="mt-0.5 text-[10px] text-ink-400">已售 slots / 总 slots</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-ink-500">草稿待发布</div>
          <div className="mt-1 text-2xl font-bold text-yellow-700">{drafts}</div>
          <div className="mt-0.5 text-[10px] text-ink-400">技师未点发布</div>
        </div>
      </div>
    </section>
  );
}
