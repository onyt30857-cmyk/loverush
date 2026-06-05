'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { PrimaryButton, GhostButton, ErrorBanner } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { PAYMENT_METHOD_TYPES, PM_TYPE_MAP, PM_LABEL } from '@/lib/paymentMethods';

interface RedeemAgentInfo {
  agentUserId: string;
  rateBps: number;
  balance: number;
}
interface RedeemOrder {
  id: string;
  points: number;
  rateBps: number;
  payoutAmount: string;
  payoutCurrency: string;
  payoutMethodType: string;
  status: 'created' | 'agent_accepted' | 'agent_paid' | 'completed' | 'disputed' | 'cancelled' | 'expired';
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  created: '待服务商接单',
  agent_accepted: '服务商处理中',
  agent_paid: '待你确认收款',
  completed: '已完成',
  disputed: '申诉中',
  cancelled: '已取消',
  expired: '已超时退回',
};
const STATUS_COLOR: Record<string, string> = {
  created: 'text-warm-600',
  agent_accepted: 'text-warm-600',
  agent_paid: 'text-primary',
  completed: 'text-success-500',
  disputed: 'text-danger-500',
  cancelled: 'text-ink-400',
  expired: 'text-ink-400',
};

export default function RedeemPage() {
  const [info, setInfo] = useState<RedeemAgentInfo | null>(null);
  const [orders, setOrders] = useState<RedeemOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [points, setPoints] = useState('');
  const [pmType, setPmType] = useState<string>('usdt_trc20');
  const [pmFields, setPmFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    void apiGet<RedeemAgentInfo | null>('/redeem/agent')
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoaded(true));
    void apiGet<RedeemOrder[]>('/redeem').then(setOrders).catch(() => setOrders([]));
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
      setError(err instanceof ApiClientError ? err.payload.message : '网络好像开小差了，稍后再试');
    } finally {
      setBusy(false);
    }
  }

  const pts = Math.floor(Number(points)) || 0;
  const rate = info ? info.rateBps / 10000 : 0;
  const estUsd = ((pts * rate) / 100).toFixed(2); // 1 积分=$0.01
  const activeOrder = orders.find((o) => ['created', 'agent_accepted', 'agent_paid'].includes(o.status));
  const history = orders.filter((o) => ['completed', 'cancelled', 'expired', 'disputed'].includes(o.status));

  async function submit() {
    const tpl = PM_TYPE_MAP[pmType];
    if (!tpl) return;
    const missing = tpl.fields.find((f) => !f.optional && !(pmFields[f.key] ?? '').trim());
    if (missing) {
      setError(`请填写${missing.label}`);
      return;
    }
    const fields: Record<string, string> = {};
    for (const f of tpl.fields) {
      const v = (pmFields[f.key] ?? '').trim();
      if (v) fields[f.key] = v;
    }
    await run(() =>
      apiPost('/redeem', { points: pts, payout_method_type: pmType, payout_method_fields: fields }).then(() => {
        setPoints('');
        setPmFields({});
      }),
    );
  }

  return (
    <AppShell title="卖回积分" showBack hideTabBar>
      {/* 余额 */}
      <div className="bg-gradient-soft px-5 pb-4 pt-5">
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">可用积分</div>
          <div className="mt-1 text-display text-4xl font-bold num">{(info?.balance ?? 0).toLocaleString()}</div>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* 进行中的回收单 */}
      {activeOrder ? (
        <section className="px-5">
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
            <div className="flex items-center justify-between">
              <div className="text-serif-cn text-[15px] font-semibold text-ink-900">
                卖回 <span className="num">{activeOrder.points.toLocaleString()}</span> 积分
              </div>
              <span className={`rounded-full bg-warm-50 px-2.5 py-1 text-[11px] ${STATUS_COLOR[activeOrder.status]}`}>
                {STATUS_LABEL[activeOrder.status]}
              </span>
            </div>
            <div className="mt-2 text-[12px] text-ink-500">
              预计到账 <span className="num font-semibold text-primary">${activeOrder.payoutAmount}</span> ·{' '}
              {PM_LABEL[activeOrder.payoutMethodType] ?? activeOrder.payoutMethodType}
            </div>

            {activeOrder.status === 'agent_paid' ? (
              <div className="mt-4 space-y-2">
                <div className="rounded-xl bg-warm-50 px-3 py-2.5 text-[12px] text-ink-600">
                  服务商已标记付款。确认收到钱后点下方按钮，积分将转给服务商。
                </div>
                <PrimaryButton onClick={() => run(() => apiPost(`/redeem/${activeOrder.id}/confirm`, {}))} loading={busy}>
                  确认已收到钱
                </PrimaryButton>
                <GhostButton onClick={() => run(() => apiPost(`/redeem/${activeOrder.id}/dispute`, {}))}>
                  没收到钱 · 申诉
                </GhostButton>
              </div>
            ) : (
              <div className="mt-4">
                <div className="rounded-xl bg-warm-50 px-3 py-2.5 text-[12px] text-ink-500">
                  积分已冻结，等服务商付款。付款后你来确认到账。
                </div>
                <div className="mt-2">
                  <GhostButton onClick={() => run(() => apiPost(`/redeem/${activeOrder.id}/cancel`, {}))}>
                    取消并退回积分
                  </GhostButton>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : loaded && !info ? (
        <section className="px-6 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm text-3xl">
            🪧
          </div>
          <div className="mt-4 text-serif-cn text-[15px] font-semibold text-ink-800">暂无可回收的服务商</div>
          <div className="mt-1.5 text-[12px] leading-5 text-ink-500">你所在地区还没有开通回收的服务商，请稍后再试</div>
        </section>
      ) : (
        /* 发起回收表单 */
        <section className="px-5">
          <div className="mb-3 mt-1 rounded-xl bg-warm-50 px-4 py-2.5 text-[12px] text-ink-600">
            当前回收价 <span className="num font-semibold text-primary">{(rate * 100).toFixed(0)}%</span> ·
            1000 积分 ≈ ${((1000 * rate) / 100).toFixed(2)}
          </div>

          <div className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">卖回数量</div>
          <div className="flex items-center gap-2 rounded-2xl border border-warm-100 bg-white px-4 py-3 shadow-warm-xs focus-within:border-primary">
            <input
              type="number"
              inputMode="numeric"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder={`最多 ${(info?.balance ?? 0).toLocaleString()}`}
              className="flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-300"
            />
            <span className="text-[12px] text-ink-400">积分</span>
          </div>
          {pts > 0 && (
            <div className="mt-2 flex items-center justify-between rounded-2xl bg-warm-50 px-4 py-3">
              <span className="text-[13px] text-ink-600">预计到账（约）</span>
              <span className="text-display text-xl font-bold text-primary num">${estUsd}</span>
            </div>
          )}

          {/* 我的收款方式 */}
          <div className="mb-2 mt-5 text-serif-cn text-[14px] font-semibold text-ink-800">你的收款方式</div>
          <select
            value={pmType}
            onChange={(e) => {
              setPmType(e.target.value);
              setPmFields({});
            }}
            className="w-full rounded-xl border border-warm-100 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-primary"
          >
            {PAYMENT_METHOD_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {PM_TYPE_MAP[pmType]?.hint && (
            <div className="mt-1.5 text-[11px] text-warm-600">{PM_TYPE_MAP[pmType]!.hint}</div>
          )}
          {(PM_TYPE_MAP[pmType]?.fields ?? []).map((f) => (
            <input
              key={f.key}
              value={pmFields[f.key] ?? ''}
              onChange={(e) => setPmFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.optional ? f.label : `${f.label} *`}
              className="mt-2 w-full rounded-xl border border-warm-100 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-primary"
            />
          ))}

          <div className="mt-5">
            <PrimaryButton
              onClick={submit}
              disabled={pts <= 0 || pts > (info?.balance ?? 0)}
              loading={busy}
            >
              {pts > (info?.balance ?? 0) ? '超过可用积分' : '发起回收 · 冻结积分'}
            </PrimaryButton>
          </div>
          <div className="mt-1.5 text-center text-[11px] text-ink-400">
            发起后积分冻结，服务商线下付款，你确认到账后完成
          </div>
        </section>
      )}

      {/* 历史 */}
      {history.length > 0 && (
        <section className="mt-6 px-5 pb-8">
          <div className="mb-2 text-serif-cn text-[13px] font-semibold text-ink-700">回收记录</div>
          <div className="divide-y divide-warm-50 rounded-2xl border border-warm-100 bg-white">
            {history.slice(0, 10).map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3">
                <span className="num text-[13px] text-ink-800">
                  {o.points.toLocaleString()} 积分 → ${o.payoutAmount}
                </span>
                <span className={`text-[11px] ${STATUS_COLOR[o.status]}`}>{STATUS_LABEL[o.status]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
