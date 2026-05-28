'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface FlowRow {
  type: string;
  d1_count: number;
  d1_amount: number;
  d7_count: number;
  d7_amount: number;
  d30_count: number;
  d30_amount: number;
}

interface Overview {
  points_circulation: {
    total_accounts: number;
    total_balance: number;
    total_frozen: number;
    avg_balance: number;
    active_accounts_30d: number;
  };
  flows: FlowRow[];
  pending: {
    withdrawals_count: number;
    withdrawals_amount_cents: number;
    wholesale_count: number;
    wholesale_points: number;
    wholesale_usdt_cents: number;
  };
  generated_at: string;
}

// 流水类型中文 + 方向 + 业务含义
const TYPE_META: Record<string, { label: string; dir: 'in' | 'out' | 'neutral'; biz: string }> = {
  RECHARGE: { label: '客户充值', dir: 'in', biz: '客户端直充(旧 Stripe,M16 后逐步替代)' },
  AGENT_WHOLESALE: { label: '代理批发入账', dir: 'in', biz: '平台→代理 USDT 9 折批发' },
  AGENT_SELL: { label: '代理售卖出账', dir: 'out', biz: '代理→客户(代理侧扣)' },
  AGENT_BUY: { label: '客户购入', dir: 'in', biz: '客户购入(M16 主入金)' },
  PAYWALL_UNLOCK: { label: '解锁付费墙', dir: 'out', biz: '客户解锁联系方式/相册' },
  TIP_GIVE: { label: '小费支付', dir: 'out', biz: '客户给小费' },
  TIP_RECEIVE: { label: '小费收入', dir: 'in', biz: '技师收到小费(扣 10-15% 抽成后)' },
  CHAT_SPEND: { label: '陪聊消费', dir: 'out', biz: '客户付费私聊' },
  CHAT_EARN: { label: '陪聊收入', dir: 'in', biz: '技师陪聊收入' },
  SHOP_PURCHASE: { label: '橱窗购买', dir: 'out', biz: '客户买技师橱窗商品' },
  SHOP_COMMISSION: { label: '橱窗分成', dir: 'in', biz: '技师橱窗分成(剩余=平台)' },
  INVITE_REWARD: { label: '邀请奖励', dir: 'in', biz: '邀请人/被邀请人奖励' },
  WITHDRAW: { label: '提现出账', dir: 'out', biz: '技师/代理提现' },
  REFUND: { label: '退款', dir: 'in', biz: '订单争议退款' },
  FROZEN: { label: '冻结', dir: 'neutral', biz: '账户冻结' },
  UNFROZEN: { label: '解冻', dir: 'neutral', biz: '账户解冻' },
  EXPIRED: { label: '积分过期', dir: 'out', biz: '到期失效' },
  ADJUSTMENT: { label: '人工调整', dir: 'neutral', biz: 'admin 干预' },
};

export default function FinancePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>('/admin/finance/overview')
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, []);

  if (error) {
    return (
      <AdminShell>
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">资金看板</h1>
        <div className="text-xs text-ink-500">
          {data ? `更新于 ${new Date(data.generated_at).toLocaleTimeString('zh-CN')}` : '加载中…'}
        </div>
      </div>

      {!data && <div className="text-sm text-ink-500">加载中…</div>}

      {data && (
        <>
          {/* 积分大盘 */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">积分大盘</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <BigStat label="账户总数" value={data.points_circulation.total_accounts.toLocaleString()} />
              <BigStat
                label="总流通"
                value={data.points_circulation.total_balance.toLocaleString()}
                sub="积分"
                accent
              />
              <BigStat
                label="活跃账户 30d"
                value={data.points_circulation.active_accounts_30d.toLocaleString()}
                sub={`${
                  data.points_circulation.total_accounts > 0
                    ? Math.round((data.points_circulation.active_accounts_30d * 100) / data.points_circulation.total_accounts)
                    : 0
                }% 活跃`}
              />
              <BigStat label="平均余额" value={data.points_circulation.avg_balance.toLocaleString()} sub="积分/账户" />
              <BigStat label="冻结余额" value={data.points_circulation.total_frozen.toLocaleString()} sub="积分" />
            </div>
          </section>

          {/* 待处理(运营注意) */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">待处理 · 运营注意</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="card">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-ink-700">
                    待审批提现
                    {data.pending.withdrawals_count > 0 && (
                      <span className="ml-2 rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                        {data.pending.withdrawals_count} 笔
                      </span>
                    )}
                  </div>
                  <a href="/withdrawals" className="text-xs text-rose-600 hover:underline">
                    去处理 →
                  </a>
                </div>
                <div className="mt-2 text-2xl font-bold text-ink-900">
                  ${(data.pending.withdrawals_amount_cents / 100).toFixed(2)}
                </div>
                <div className="mt-0.5 text-xs text-ink-500">技师/代理总申请额</div>
              </div>

              <div className="card">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-ink-700">
                    待确认 USDT 批发
                    {data.pending.wholesale_count > 0 && (
                      <span className="ml-2 rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                        {data.pending.wholesale_count} 单
                      </span>
                    )}
                  </div>
                  <a href="/agents" className="text-xs text-rose-600 hover:underline">
                    去处理 →
                  </a>
                </div>
                <div className="mt-2 text-2xl font-bold text-ink-900">
                  {data.pending.wholesale_points.toLocaleString()} <span className="text-sm font-normal text-ink-500">积分待入</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-500">
                  应收 USDT ${(data.pending.wholesale_usdt_cents / 100).toFixed(2)}
                </div>
              </div>
            </div>
          </section>

          {/* 各类流水 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-700">
              资金流水 · 各类型聚合
              <span className="ml-2 text-xs font-normal text-ink-400">(单位:积分 · 1 积分 ≈ $0.01)</span>
            </h2>
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>业务含义</th>
                    <th className="text-right">24h 笔数</th>
                    <th className="text-right">24h 积分</th>
                    <th className="text-right">7d 笔数</th>
                    <th className="text-right">7d 积分</th>
                    <th className="text-right">30d 笔数</th>
                    <th className="text-right">30d 积分</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-ink-500">
                        30 天内无流水(系统初期/或数据未生成)
                      </td>
                    </tr>
                  )}
                  {data.flows.map((f) => {
                    const meta = TYPE_META[f.type] ?? { label: f.type, dir: 'neutral' as const, biz: '' };
                    return (
                      <tr key={f.type}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                meta.dir === 'in' ? 'bg-green-500' : meta.dir === 'out' ? 'bg-rose-500' : 'bg-ink-400'
                              }`}
                            />
                            <span className="font-medium">{meta.label}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-400">{f.type}</div>
                        </td>
                        <td className="text-xs text-ink-500">{meta.biz}</td>
                        <td className="text-right text-xs">{f.d1_count.toLocaleString()}</td>
                        <td className="text-right font-mono text-xs">{f.d1_amount.toLocaleString()}</td>
                        <td className="text-right text-xs">{f.d7_count.toLocaleString()}</td>
                        <td className="text-right font-mono text-xs">{f.d7_amount.toLocaleString()}</td>
                        <td className="text-right text-xs">{f.d30_count.toLocaleString()}</td>
                        <td className="text-right font-mono text-sm font-semibold">{f.d30_amount.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-ink-500">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                入账
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                出账
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-ink-400" />
                中性(冻结/解冻/调整)
              </span>
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}

function BigStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`card ${accent ? 'bg-gradient-to-br from-rose-50 to-white' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-rose-700' : 'text-ink-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}
