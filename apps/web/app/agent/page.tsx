'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PrimaryButton, GhostButton, ErrorBanner } from '@/components/ui';
import { apiGet, apiPost, apiPut, apiDelete, ApiClientError } from '@/lib/api';

const WHOLESALE_RATE = 0.9;
const METHOD_LABEL: Record<string, string> = { bank: '银行转账', alipay: '支付宝', wechat: '微信' };

interface PaymentMethod {
  id: string;
  country: string;
  methodType: 'bank' | 'alipay' | 'wechat';
  fields: Record<string, string>;
  minPurchasePoints: number;
  isActive: boolean;
}
interface WholesaleOrder {
  id: string;
  points: number;
  usdtAmountCents: number;
  status: 'pending' | 'confirmed' | 'rejected';
}
interface PurchaseOrder {
  id: string;
  points: number;
  status: string;
  createdAt: string;
}

export default function AgentConsolePage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [wholesale, setWholesale] = useState<WholesaleOrder[]>([]);
  const [pending, setPending] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 批发表单
  const [wsPoints, setWsPoints] = useState('');
  // 收款方式表单
  const [pmCountry, setPmCountry] = useState('TH');
  const [pmType, setPmType] = useState<'bank' | 'alipay' | 'wechat'>('bank');
  const [pmAccount, setPmAccount] = useState('');
  const [pmHolder, setPmHolder] = useState('');
  const [pmMin, setPmMin] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await apiGet<{ balance: number }>('/agent/me');
      setIsAgent(true);
      setBalance(me.balance);
      const [pm, ws, po] = await Promise.all([
        apiGet<PaymentMethod[]>('/agent/payment-methods').catch(() => []),
        apiGet<WholesaleOrder[]>('/agent/wholesale').catch(() => []),
        apiGet<PurchaseOrder[]>('/agent/purchase-orders?status=customer_paid').catch(() => []),
      ]);
      setMethods(pm);
      setWholesale(ws);
      setPending(po);
    } catch (err) {
      if (err instanceof ApiClientError && err.payload.code === 'E2020') {
        setIsAgent(false); // 无 agent 角色
      } else if (err instanceof ApiClientError) {
        setError(err.payload.message);
        setIsAgent(false);
      } else {
        setIsAgent(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (isAgent === null) {
    return <div className="mobile-container bg-gradient-soft px-5 py-10 text-center text-sm text-ink-400">加载中…</div>;
  }
  if (isAgent === false) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <header className="flex h-12 items-center border-b border-ink-100 bg-white/95 px-4">
          <button type="button" onClick={() => router.back()} className="-ml-2 mr-1 h-9 w-9 rounded-full text-ink-700">←</button>
          <h1 className="text-base font-semibold">服务商控制台</h1>
        </header>
        <div className="px-6 py-16 text-center">
          <div className="text-4xl">🔑</div>
          <div className="mt-3 text-base font-medium text-ink-800">你还不是积分服务商</div>
          <div className="mt-1 text-sm text-ink-500">如需成为服务商，请联系平台开通。</div>
        </div>
      </div>
    );
  }

  const wsPts = Math.floor(Number(wsPoints)) || 0;
  const wsUsdt = ((wsPts * WHOLESALE_RATE) / 100).toFixed(2);

  return (
    <div className="mobile-container bg-gradient-soft pb-10">
      <header className="sticky top-0 z-30 flex h-12 items-center border-b border-ink-100 bg-white/95 px-4 backdrop-blur">
        <button type="button" onClick={() => router.back()} className="-ml-2 mr-1 h-9 w-9 rounded-full text-ink-700">←</button>
        <h1 className="text-base font-semibold">服务商控制台</h1>
      </header>

      {/* 余额 */}
      <div className="px-5 pt-5">
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">AGENT BALANCE</div>
          <div className="mt-1 flex items-end gap-2">
            <div className="text-display text-4xl font-bold num">{(balance ?? 0).toLocaleString()}</div>
            <div className="pb-1 text-xs text-white/80">积分</div>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* 待确认订单 */}
      <section className="px-5 pt-5">
        <div className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">
          待确认收款 {pending.length > 0 && <span className="text-primary num">({pending.length})</span>}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-warm-100 bg-white px-4 py-6 text-center text-[13px] text-ink-400">
            暂无待确认订单
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-2xl border border-warm-100 bg-white px-4 py-3">
                <div>
                  <div className="num text-[15px] font-semibold text-ink-900">{o.points.toLocaleString()} 积分</div>
                  <div className="text-[11px] text-ink-400">客户已标记付款</div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => apiPost(`/agent/purchase-orders/${o.id}/confirm`, {}))}
                  className="rounded-full bg-gradient-cta px-4 py-2 text-[13px] font-medium text-white active:scale-95 disabled:opacity-50"
                >
                  确认收款·发积分
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 批发进货 */}
      <section className="px-5 pt-6">
        <div className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">批发进货（USDT 9 折）</div>
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="flex items-center gap-2 rounded-xl border border-warm-100 px-3 py-2.5 focus-within:border-primary">
            <input
              type="number"
              inputMode="numeric"
              value={wsPoints}
              onChange={(e) => setWsPoints(e.target.value)}
              placeholder="进货积分数量"
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-300"
            />
            <span className="text-[12px] text-ink-400">积分</span>
          </div>
          {wsPts > 0 && (
            <div className="mt-2 text-center text-[12px] text-ink-500">
              应付 <span className="num font-bold text-primary">{wsUsdt} USDT</span>（面值 ${(wsPts / 100).toFixed(2)} × 9 折）
            </div>
          )}
          <div className="mt-3">
            <PrimaryButton
              onClick={() => run(async () => { await apiPost('/agent/wholesale', { points: wsPts }); setWsPoints(''); })}
              disabled={wsPts <= 0}
              loading={busy}
            >
              提交批发单
            </PrimaryButton>
          </div>
          <div className="mt-2 text-center text-[11px] text-ink-400">提交后向平台转 USDT，平台确认到账后积分入账</div>
        </div>
        {wholesale.length > 0 && (
          <div className="mt-2 divide-y divide-warm-50 rounded-2xl border border-warm-100 bg-white">
            {wholesale.slice(0, 5).map((w) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-2.5 text-[12px]">
                <span className="num text-ink-700">+{w.points.toLocaleString()} 积分 · {(w.usdtAmountCents / 100).toFixed(2)} USDT</span>
                <span className={w.status === 'confirmed' ? 'text-success-500' : w.status === 'rejected' ? 'text-danger-500' : 'text-warm-600'}>
                  {w.status === 'confirmed' ? '已入账' : w.status === 'rejected' ? '已驳回' : '待确认'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 收款方式 */}
      <section className="px-5 pt-6">
        <div className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">收款方式</div>
        {methods.length > 0 && (
          <div className="mb-3 space-y-2">
            {methods.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-2xl border border-warm-100 bg-white px-4 py-3">
                <div>
                  <div className="text-[13px] font-medium text-ink-900">{METHOD_LABEL[m.methodType]} · {m.country}</div>
                  <div className="text-[11px] text-ink-400">
                    {m.fields.account ?? Object.values(m.fields)[0] ?? ''} · 最小 {m.minPurchasePoints.toLocaleString()}
                  </div>
                </div>
                <button type="button" disabled={busy} onClick={() => run(() => apiDelete(`/agent/payment-methods/${m.id}`))} className="text-[12px] text-danger-500">
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="mb-2 text-[12px] font-medium text-ink-600">新增收款方式</div>
          <div className="grid grid-cols-2 gap-2">
            <input value={pmCountry} onChange={(e) => setPmCountry(e.target.value.toUpperCase())} placeholder="国家(TH)" className="rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary" />
            <select value={pmType} onChange={(e) => setPmType(e.target.value as typeof pmType)} className="rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary">
              <option value="bank">银行转账</option>
              <option value="alipay">支付宝</option>
              <option value="wechat">微信</option>
            </select>
          </div>
          <input value={pmHolder} onChange={(e) => setPmHolder(e.target.value)} placeholder="收款人姓名" className="mt-2 w-full rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <input value={pmAccount} onChange={(e) => setPmAccount(e.target.value)} placeholder="账号 / 收款码链接" className="mt-2 w-full rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <input value={pmMin} onChange={(e) => setPmMin(e.target.value)} type="number" inputMode="numeric" placeholder="最小购买积分(可选)" className="mt-2 w-full rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <div className="mt-3">
            <GhostButton
              onClick={() =>
                run(async () => {
                  if (!pmAccount.trim()) throw new Error('请填写账号');
                  await apiPut('/agent/payment-methods', {
                    country: pmCountry || 'TH',
                    method_type: pmType,
                    fields: { holder: pmHolder, account: pmAccount },
                    min_purchase_points: Math.floor(Number(pmMin)) || 0,
                  });
                  setPmAccount('');
                  setPmHolder('');
                  setPmMin('');
                })
              }
            >
              添加收款方式
            </GhostButton>
          </div>
        </div>
      </section>
    </div>
  );
}
