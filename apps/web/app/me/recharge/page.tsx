'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { PrimaryButton, GhostButton, ErrorBanner } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

const PRESETS = [5000, 10000, 20000, 50000]; // 积分（站内 1 积分 = $0.01）
const CENT_PER_POINT = 1; // 1 积分 = 1 美分

interface PaymentMethod {
  id: string;
  country: string;
  methodType: 'bank' | 'alipay' | 'wechat';
  fields: Record<string, string>;
  minPurchasePoints: number;
}
interface AgentInfo {
  agentUserId: string;
  paymentMethods: PaymentMethod[];
}
interface PurchaseOrder {
  id: string;
  points: number;
  status: 'created' | 'customer_paid' | 'agent_confirmed' | 'points_sent' | 'disputed' | 'cancelled' | 'expired';
  methodSnapshot?: { methodType: string; fields: Record<string, string>; country: string };
  createdAt: string;
}

const METHOD_LABEL: Record<string, string> = { bank: '银行转账', alipay: '支付宝', wechat: '微信' };
const STATUS_LABEL: Record<string, string> = {
  created: '待付款',
  customer_paid: '待服务商确认',
  agent_confirmed: '确认中',
  points_sent: '已到账',
  disputed: '争议中',
  cancelled: '已取消',
  expired: '已过期',
};

export default function RechargePage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [points, setPoints] = useState<number>(5000);
  const [custom, setCustom] = useState('');
  const [methodId, setMethodId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [dash, ag, ords] = await Promise.all([
        apiGet<{ points?: { balance: string } }>('/dashboard/customer/me').catch(
          (): { points?: { balance: string } } => ({}),
        ),
        apiGet<AgentInfo | null>('/point-purchases/agent').catch(() => null),
        apiGet<PurchaseOrder[]>('/point-purchases').catch(() => []),
      ]);
      setBalance(parseInt(dash.points?.balance ?? '0', 10));
      setAgent(ag);
      setOrders(ords);
      if (ag && ag.paymentMethods.length > 0 && !methodId) setMethodId(ag.paymentMethods[0]!.id);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setLoaded(true);
    }
  }, [methodId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeOrder = orders.find((o) => o.status === 'created' || o.status === 'customer_paid');
  const history = orders.filter((o) => o.status === 'points_sent');
  const selectedMethod = agent?.paymentMethods.find((m) => m.id === methodId);
  const amount = custom ? Math.floor(Number(custom)) : points;
  const minPts = selectedMethod?.minPurchasePoints ?? 0;
  const valid = Number.isFinite(amount) && amount >= Math.max(1, minPts) && !!methodId;
  const usd = ((amount * CENT_PER_POINT) / 100).toFixed(2);

  async function placeOrder() {
    if (!valid || busy || !selectedMethod) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/point-purchases', {
        points: amount,
        payment_method_id: methodId,
        country: selectedMethod.country,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(orderId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/point-purchases/${orderId}/paid`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="购买积分" showBack hideTabBar>
      {/* 余额 */}
      <div className="bg-gradient-soft px-5 pb-5 pt-5">
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">POINTS BALANCE</div>
          <div className="mt-1 flex items-end gap-2">
            <div className="text-display text-4xl font-bold num">{balance == null ? '—' : balance.toLocaleString()}</div>
            <div className="pb-1 text-xs text-white/80">积分</div>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />

      {!loaded ? (
        <div className="px-5 py-8 text-center text-sm text-ink-400">加载中…</div>
      ) : !agent ? (
        <div className="px-6 py-12 text-center">
          <div className="text-4xl">🪧</div>
          <div className="mt-3 text-base font-medium text-ink-800">暂无可用积分服务商</div>
          <div className="mt-1 text-sm text-ink-500">你所在地区还没有服务商，请稍后再试或联系客服。</div>
        </div>
      ) : activeOrder ? (
        /* ── 有进行中订单：显示收款指引 / 等待 ── */
        <section className="px-5">
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
            <div className="flex items-center justify-between">
              <div className="text-serif-cn text-[15px] font-semibold text-ink-900">
                购买 <span className="num">{activeOrder.points.toLocaleString()}</span> 积分
              </div>
              <span className="rounded-full bg-warm-100 px-2.5 py-1 text-[11px] text-warm-700">
                {STATUS_LABEL[activeOrder.status]}
              </span>
            </div>

            {activeOrder.status === 'created' && activeOrder.methodSnapshot && (
              <>
                <div className="mt-3 text-[12px] text-ink-500">
                  请向服务商付款（{METHOD_LABEL[activeOrder.methodSnapshot.methodType] ?? activeOrder.methodSnapshot.methodType} ·{' '}
                  {activeOrder.methodSnapshot.country}），到账后点下方按钮通知服务商发放积分。
                </div>
                <div className="mt-3 space-y-2 rounded-xl bg-ink-50 p-3">
                  {Object.entries(activeOrder.methodSnapshot.fields).map(([k, v]) =>
                    /qr|url|码/i.test(k) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={k} src={v} alt="收款码" className="mx-auto h-40 w-40 rounded-lg object-contain" />
                    ) : (
                      <div key={k} className="flex justify-between text-[13px]">
                        <span className="text-ink-500">{k}</span>
                        <span className="font-medium text-ink-900">{v}</span>
                      </div>
                    ),
                  )}
                </div>
                <div className="mt-4">
                  <PrimaryButton onClick={() => markPaid(activeOrder.id)} loading={busy}>
                    我已付款，通知服务商
                  </PrimaryButton>
                </div>
              </>
            )}

            {activeOrder.status === 'customer_paid' && (
              <div className="mt-3 rounded-xl bg-warm-50 px-4 py-4 text-center">
                <div className="text-sm text-ink-700">已通知服务商，等待确认到账</div>
                <div className="mt-1 text-[12px] text-ink-400">通常几分钟内到账，可下拉刷新</div>
                <div className="mt-3">
                  <GhostButton onClick={() => void load()}>刷新状态</GhostButton>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* ── 购买表单 ── */
        <section className="px-5">
          <div className="mb-3 text-serif-cn text-[14px] font-semibold text-ink-800">选择购买数量</div>
          <div className="grid grid-cols-2 gap-2.5">
            {PRESETS.map((v) => {
              const on = !custom && points === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setPoints(v);
                    setCustom('');
                  }}
                  className={`rounded-2xl border py-3 text-center transition active:scale-[0.98] ${
                    on ? 'border-primary bg-primary/5 shadow-warm-sm' : 'border-warm-100 bg-white shadow-warm-xs'
                  }`}
                >
                  <div className={`text-display text-lg font-bold num ${on ? 'text-primary' : 'text-ink-800'}`}>
                    {v.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-500">≈ ${((v * CENT_PER_POINT) / 100).toFixed(0)}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-warm-100 bg-white px-4 py-3 shadow-warm-xs focus-within:border-primary">
            <input
              type="number"
              inputMode="numeric"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={`自定义积分${minPts ? `（≥ ${minPts.toLocaleString()}）` : ''}`}
              className="flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-300"
            />
            <span className="text-[12px] text-ink-400">积分</span>
          </div>

          {/* 收款方式选择 */}
          <div className="mb-2 mt-5 text-serif-cn text-[14px] font-semibold text-ink-800">向服务商支付方式</div>
          <div className="space-y-2">
            {agent.paymentMethods.map((m) => {
              const on = methodId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethodId(m.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                    on ? 'border-primary bg-primary/5' : 'border-warm-100 bg-white'
                  }`}
                >
                  <div>
                    <div className="text-[13px] font-medium text-ink-900">
                      {METHOD_LABEL[m.methodType] ?? m.methodType} · {m.country}
                    </div>
                    {m.minPurchasePoints > 0 && (
                      <div className="text-[11px] text-ink-400">最小 {m.minPurchasePoints.toLocaleString()} 积分</div>
                    )}
                  </div>
                  <span className={`h-4 w-4 rounded-full border-2 ${on ? 'border-primary bg-primary' : 'border-ink-200'}`} />
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-warm-50 px-4 py-3">
            <span className="text-[13px] text-ink-600">应付（约）</span>
            <span className="text-display text-xl font-bold text-primary num">${usd}</span>
          </div>
          <div className="mt-1.5 text-center text-[11px] text-ink-400">向服务商支付当地等值法币 · 1 积分 ≈ $0.01</div>

          <div className="mt-5">
            <PrimaryButton onClick={placeOrder} disabled={!valid} loading={busy}>
              {valid ? '下单并获取收款方式' : minPts && amount < minPts ? `最少购买 ${minPts.toLocaleString()} 积分` : '请选择数量与方式'}
            </PrimaryButton>
          </div>
        </section>
      )}

      {/* 购买记录 */}
      {history.length > 0 && (
        <section className="mt-6 px-5 pb-8">
          <div className="mb-2 text-serif-cn text-[13px] font-semibold text-ink-700">购买记录</div>
          <div className="divide-y divide-warm-50 rounded-2xl border border-warm-100 bg-white">
            {history.slice(0, 10).map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3">
                <span className="num text-[13px] text-ink-800">+{o.points.toLocaleString()} 积分</span>
                <span className="text-[11px] text-success-500">{STATUS_LABEL[o.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
