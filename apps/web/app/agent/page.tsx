'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PrimaryButton, GhostButton, ErrorBanner } from '@/components/ui';
import { apiGet, apiPost, apiPut, apiDelete, ApiClientError } from '@/lib/api';
import { PAYMENT_METHOD_TYPES, PM_LABEL, PM_TYPE_MAP, pmPrimaryValue } from '@/lib/paymentMethods';

const WHOLESALE_RATE = 0.9;

interface PaymentMethod {
  id: string;
  country: string;
  methodType: string;
  fields: Record<string, string>;
  minPurchasePoints: number;
  isActive: boolean;
}
interface WholesaleOrder {
  id: string;
  points: number;
  usdtAmountCents: number;
  status: 'pending' | 'confirmed' | 'rejected';
  agentTxnRef: string | null;
  rejectReason: string | null;
}
interface PlatformAccount {
  id: string;
  methodType: string;
  label: string;
  fields: Record<string, string>;
}
interface PurchaseOrder {
  id: string;
  points: number;
  status: string;
  createdAt: string;
}
interface RedeemOrder {
  id: string;
  points: number;
  payoutAmount: string;
  payoutCurrency: string;
  payoutMethodType: string;
  payoutMethodFields: Record<string, string>;
  status: 'created' | 'agent_accepted' | 'agent_paid' | 'completed' | 'disputed' | 'cancelled' | 'expired';
  createdAt: string;
}

export default function AgentConsolePage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [isAgent, setIsAgent] = useState<boolean | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [wholesale, setWholesale] = useState<WholesaleOrder[]>([]);
  const [pending, setPending] = useState<PurchaseOrder[]>([]);
  const [redeems, setRedeems] = useState<RedeemOrder[]>([]);
  const [platformAccounts, setPlatformAccounts] = useState<PlatformAccount[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [wsTxnRef, setWsTxnRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 批发表单
  const [wsPoints, setWsPoints] = useState('');
  // 收款方式表单（按类型字段模板动态渲染）
  const [pmCountry, setPmCountry] = useState('TH');
  const [pmType, setPmType] = useState<string>('bank');
  const [pmFields, setPmFields] = useState<Record<string, string>>({});
  const [pmMin, setPmMin] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await apiGet<{ balance: number }>('/agent/me');
      setIsAgent(true);
      setBalance(me.balance);
      const [pm, ws, po, rd, pa] = await Promise.all([
        apiGet<PaymentMethod[]>('/agent/payment-methods').catch(() => []),
        apiGet<WholesaleOrder[]>('/agent/wholesale').catch(() => []),
        apiGet<PurchaseOrder[]>('/agent/purchase-orders?status=customer_paid').catch(() => []),
        apiGet<RedeemOrder[]>('/agent/redeem').catch(() => []),
        apiGet<PlatformAccount[]>('/agent/platform-accounts').catch(() => []),
      ]);
      setMethods(pm);
      setWholesale(ws);
      setPending(po);
      setRedeems(rd);
      setPlatformAccounts(pa);
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
        <div className="px-8 py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm text-3xl">🔑</div>
          <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">你还不是积分服务商</div>
          <div className="mt-1.5 text-[12.5px] leading-6 text-ink-500">
            代理身份由平台运营评估开放
            <br />
            如需申请,联系平台客服
          </div>
          <button
            type="button"
            onClick={() => router.push('/me')}
            className="mt-5 inline-flex items-center gap-1 rounded-full bg-warm-50 px-4 py-1.5 text-[12px] text-ink-700 shadow-warm-xs active:scale-95"
          >
            返回我的 →
          </button>
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

      {/* 待回收（持有人卖回积分 → 代理付款回收） */}
      {redeems.filter((r) => ['created', 'agent_accepted', 'agent_paid'].includes(r.status)).length > 0 && (
        <section className="px-5 pt-6">
          <div className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">
            待回收 <span className="text-primary num">({redeems.filter((r) => ['created', 'agent_accepted', 'agent_paid'].includes(r.status)).length})</span>
          </div>
          <div className="space-y-2">
            {redeems
              .filter((r) => ['created', 'agent_accepted', 'agent_paid'].includes(r.status))
              .map((r) => (
                <div key={r.id} className="rounded-2xl border border-warm-100 bg-white px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="num text-[15px] font-semibold text-ink-900">{r.points.toLocaleString()} 积分</div>
                    <div className="num text-[13px] text-primary">付 ${r.payoutAmount}</div>
                  </div>
                  <div className="mt-1.5 space-y-0.5 rounded-lg bg-ink-50 px-3 py-2">
                    <div className="text-[11px] font-medium text-ink-600">{PM_LABEL[r.payoutMethodType] ?? r.payoutMethodType}</div>
                    {Object.entries(r.payoutMethodFields).map(([k, v]) => {
                      const field = PM_TYPE_MAP[r.payoutMethodType]?.fields.find((f) => f.key === k);
                      return (
                        <div key={k} className="flex justify-between text-[11px]">
                          <span className="text-ink-400">{field?.label ?? k}</span>
                          <span className="text-ink-800">{v}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2.5">
                    {r.status === 'created' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => apiPost(`/agent/redeem/${r.id}/accept`, {}))}
                        className="w-full rounded-full bg-gradient-cta px-4 py-2 text-[13px] font-medium text-white active:scale-95 disabled:opacity-50"
                      >
                        接单
                      </button>
                    )}
                    {r.status === 'agent_accepted' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => apiPost(`/agent/redeem/${r.id}/paid`, {}))}
                        className="w-full rounded-full bg-gradient-cta px-4 py-2 text-[13px] font-medium text-white active:scale-95 disabled:opacity-50"
                      >
                        已向对方付款
                      </button>
                    )}
                    {r.status === 'agent_paid' && (
                      <div className="text-center text-[12px] text-ink-400">已付款 · 待对方确认到账</div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

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
          {/* 平台收款地址 */}
          {platformAccounts.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="text-[11px] font-medium text-ink-500">向平台转 USDT 到以下地址，转账后到下方单据填凭证：</div>
              {platformAccounts.map((a) => (
                <div key={a.id} className="rounded-xl bg-ink-50 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-ink-700">{a.label}</span>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(a.fields.address ?? '')}
                      className="text-[11px] text-primary"
                    >
                      复制
                    </button>
                  </div>
                  <div className="mt-0.5 break-all font-mono text-[11px] text-ink-600">
                    {a.fields.address ?? Object.values(a.fields)[0]}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-warm-50 px-3 py-2 text-center text-[11px] text-warm-600">
              平台暂未配置收款账户，请联系客服
            </div>
          )}
        </div>
        {wholesale.length > 0 && (
          <div className="mt-2 space-y-2">
            {wholesale.slice(0, 5).map((w) => (
              <div key={w.id} className="rounded-2xl border border-warm-100 bg-white px-4 py-2.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="num text-ink-700">+{w.points.toLocaleString()} 积分 · {(w.usdtAmountCents / 100).toFixed(2)} USDT</span>
                  <span className={w.status === 'confirmed' ? 'text-success-500' : w.status === 'rejected' ? 'text-danger-500' : 'text-warm-600'}>
                    {w.status === 'confirmed' ? '已入账' : w.status === 'rejected' ? '已驳回' : w.agentTxnRef ? '凭证已填·待确认' : '待转账'}
                  </span>
                </div>
                {w.status === 'rejected' && w.rejectReason && (
                  <div className="mt-1 text-[11px] text-danger-500">驳回原因：{w.rejectReason}</div>
                )}
                {w.status === 'pending' &&
                  (payingId === w.id ? (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={wsTxnRef}
                        onChange={(e) => setWsTxnRef(e.target.value)}
                        placeholder="USDT 转账哈希 / 流水号"
                        className="flex-1 rounded-lg border border-warm-100 px-2 py-1.5 text-[12px] outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        disabled={busy || !wsTxnRef.trim()}
                        onClick={() =>
                          run(async () => {
                            await apiPost(`/agent/wholesale/${w.id}/paid`, { txn_ref: wsTxnRef.trim() });
                            setPayingId(null);
                            setWsTxnRef('');
                          })
                        }
                        className="rounded-lg bg-gradient-cta px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
                      >
                        提交
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPayingId(w.id);
                        setWsTxnRef(w.agentTxnRef ?? '');
                      }}
                      className="mt-2 text-[12px] text-primary"
                    >
                      {w.agentTxnRef ? '修改转账凭证' : '我已转账 · 填凭证 →'}
                    </button>
                  ))}
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
                  <div className="text-[13px] font-medium text-ink-900">{PM_LABEL[m.methodType] ?? m.methodType} · {m.country}</div>
                  <div className="text-[11px] text-ink-400">
                    {pmPrimaryValue(m.methodType, m.fields)} · 最小 {m.minPurchasePoints.toLocaleString()}
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
            <select value={pmType} onChange={(e) => { setPmType(e.target.value); setPmFields({}); }} className="rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary">
              {PAYMENT_METHOD_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          {PM_TYPE_MAP[pmType]?.hint && (
            <div className="mt-1.5 text-[11px] text-warm-600">{PM_TYPE_MAP[pmType]!.hint}</div>
          )}
          {(PM_TYPE_MAP[pmType]?.fields ?? []).map((f) => (
            <input
              key={f.key}
              value={pmFields[f.key] ?? ''}
              onChange={(e) => setPmFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.optional ? f.label : `${f.label} *`}
              className="mt-2 w-full rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
          ))}
          <input value={pmMin} onChange={(e) => setPmMin(e.target.value)} type="number" inputMode="numeric" placeholder="最小购买积分(可选)" className="mt-2 w-full rounded-xl border border-warm-100 px-3 py-2 text-[13px] outline-none focus:border-primary" />
          <div className="mt-3">
            <GhostButton
              onClick={() =>
                run(async () => {
                  const tpl = PM_TYPE_MAP[pmType];
                  if (!tpl) throw new Error('请选择收款方式');
                  const missing = tpl.fields.find((f) => !f.optional && !(pmFields[f.key] ?? '').trim());
                  if (missing) throw new Error(`请填写${missing.label}`);
                  const fields: Record<string, string> = {};
                  for (const f of tpl.fields) {
                    const v = (pmFields[f.key] ?? '').trim();
                    if (v) fields[f.key] = v;
                  }
                  await apiPut('/agent/payment-methods', {
                    country: pmCountry || 'TH',
                    method_type: pmType,
                    fields,
                    min_purchase_points: Math.floor(Number(pmMin)) || 0,
                  });
                  setPmFields({});
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
