'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { PrimaryButton, GhostButton, ErrorBanner } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';
import useSWR from 'swr';
import { PM_LABEL, PM_TYPE_MAP } from '@/lib/paymentMethods';

const PRESETS = [5000, 10000, 20000, 50000]; // 积分（站内 1 积分 = $0.01）
const CENT_PER_POINT = 1; // 1 积分 = 1 美分

interface PaymentMethod {
  id: string;
  country: string;
  methodType: string;
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

const METHOD_LABEL = PM_LABEL;
const STATUS_LABEL: Record<string, string> = {
  created: '待付款',
  customer_paid: '待服务商确认',
  agent_confirmed: '确认中',
  points_sent: '已到账',
  disputed: '争议中',
  cancelled: '已取消',
  expired: '已过期',
};

// C2 修复 · §0/§4：移除整页 "加载中…" 阻塞，进页立刻显积分卡 + 数量选择骨架；
// 三个接口任一失败都走 friendly empty / 局部占位，不再 5s 卡白屏。
export default function RechargePage() {
  const { user } = useAuth();
  const { data: currencies } = useSWR<CurrencyMini[]>('/currencies');
  const userCurrency = user?.defaultCurrencyCode ?? null;
  const [balance, setBalance] = useState<number | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [points, setPoints] = useState<number>(5000);
  const [custom, setCustom] = useState('');
  const [methodId, setMethodId] = useState<string>('');
  const [localAmount, setLocalAmount] = useState(''); // 客户实付的本地金额(可选,留作仲裁判责)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M18 · 从陪聊"为这段心动·添点温度"跳来时显情绪化头(保"不硬")· 用 location 避 useSearchParams Suspense
  const [fromCompanion, setFromCompanion] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setFromCompanion(new URLSearchParams(window.location.search).get('from') === 'companion');
    }
  }, []);

  const balanceLabel = balance == null
    ? '—'
    : userCurrency && currencies
      ? pointsToFiatLabel(balance, userCurrency, currencies)
      : `${balance.toLocaleString()} 积分`;

  const load = useCallback(async () => {
    // 三个接口完全独立，并行触发，任一失败走 fallback，不阻塞其他
    void apiGet<{ points?: { balance: string } }>('/dashboard/customer/me')
      .then((dash) => setBalance(parseInt(dash.points?.balance ?? '0', 10)))
      .catch(() => setBalance(0));

    void apiGet<AgentInfo | null>('/point-purchases/agent')
      .then((ag) => {
        setAgent(ag);
        if (ag && ag.paymentMethods.length > 0) {
          // functional set:不读闭包 methodId → 不进 useEffect 依赖,避免 methodId 变化触发 load 循环
          setMethodId((cur) => cur || ag.paymentMethods[0]!.id);
        }
      })
      .catch(() => setAgent(null))
      .finally(() => setLoaded(true));

    void apiGet<PurchaseOrder[]>('/point-purchases')
      .then(setOrders)
      .catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeOrder = orders.find((o) => o.status === 'created' || o.status === 'customer_paid');
  const history = orders.filter((o) => o.status === 'points_sent');
  const selectedMethod = agent?.paymentMethods.find((m) => m.id === methodId);
  const amount = custom ? Math.floor(Number(custom)) : points;
  const minPts = selectedMethod?.minPurchasePoints ?? 0;
  const hasMethods = !!agent && agent.paymentMethods.length > 0;
  const amountOk = Number.isFinite(amount) && amount >= Math.max(1, minPts);
  const valid = amountOk && !!methodId;
  const usd = ((amount * CENT_PER_POINT) / 100).toFixed(2);
  const payLabel = userCurrency && currencies ? pointsToFiatLabel(amount, userCurrency, currencies) : `$${usd}`;
  // 积分↔法币汇率明示(pointsPerUnit = 1 单位法币换多少积分,如 1฿≈3积分);无客户币种/汇率回退站内锚定
  const fiatCur = userCurrency && currencies ? currencies.find((c) => c.code === userCurrency) : undefined;
  const pointsRate = fiatCur?.pointsPerUnit ? parseFloat(fiatCur.pointsPerUnit) : null;
  const rateLabel =
    fiatCur && pointsRate && Number.isFinite(pointsRate) && pointsRate > 0
      ? `1 ${fiatCur.symbol} ≈ ${pointsRate.toLocaleString()} 积分`
      : '1 积分 ≈ $0.01';
  // 实付估算(本地法币):按汇率把积分折回法币;无客户汇率回退美元面值。客户可改成真实转账金额。
  const estLocal = pointsRate && pointsRate > 0 ? amount / pointsRate : (amount * CENT_PER_POINT) / 100;
  const estLocalStr = Number.isFinite(estLocal) && estLocal > 0 ? estLocal.toFixed(2) : '';
  const localCurLabel = fiatCur?.symbol ?? userCurrency ?? '$';

  async function placeOrder() {
    if (!valid || busy || !selectedMethod) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/point-purchases', {
        points: amount,
        payment_method_id: methodId,
        country: selectedMethod.country,
        local_amount: localAmount.trim() || estLocalStr || undefined,
        local_currency: userCurrency ?? undefined,
      });
      setLocalAmount('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : '网络好像开小差了，稍后再试');
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
      setError(err instanceof ApiClientError ? err.payload.message : '网络好像开小差了，稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="充值" showBack hideTabBar>
      {/* M18 · 从陪聊来的情绪化头 · 把"购买积分"软化成"为这段心动添温度" */}
      {fromCompanion && (
        <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 to-warm-50 px-4 py-3">
          <span className="mt-0.5 text-[15px]">💗</span>
          <div className="text-[12px] leading-5 text-ink-700">
            <span className="font-semibold text-primary-600">为你们的心动值添点温度</span>
            <div className="mt-0.5 text-ink-500">充能后回到她身边，把刚才那句话听完 · 日常陪聊永远免费</div>
          </div>
        </div>
      )}
      {/* 余额(0028 按客户法币显) */}
      <div className="bg-gradient-soft px-5 pb-5 pt-5">
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">BALANCE</div>
          <div className="mt-1 flex items-end gap-2">
            <div className="text-display text-4xl font-bold num">{balanceLabel}</div>
          </div>
        </div>
        <a
          href="/me/redeem"
          className="mt-2.5 flex items-center justify-center gap-1 text-[12px] text-ink-500 active:text-primary"
        >
          积分用不完？卖回换钱 →
        </a>
      </div>

      <ErrorBanner message={error} />

      {/*
        三态切换（不再有 "加载中…" 文字阻塞）：
        - 有进行中订单 → 收款指引
        - 数据已 loaded 且无 agent → 空态 + 重试
        - 其它情况（含正在加载 agent / 已有 agent）→ 直接显数量与方式表单
          · 没 agent 时方式列表显占位骨架，agent 到了无声替换
      */}
      {activeOrder ? (
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
                  {Object.entries(activeOrder.methodSnapshot.fields).map(([k, v]) => {
                    const field = PM_TYPE_MAP[activeOrder.methodSnapshot!.methodType]?.fields.find((f) => f.key === k);
                    const isQr = field?.isQr || /qr|url|码/i.test(k);
                    return isQr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={k} src={v} alt="收款码" className="mx-auto h-40 w-40 rounded-lg object-contain" />
                    ) : (
                      <div key={k} className="flex justify-between text-[13px]">
                        <span className="text-ink-500">{field?.label ?? k}</span>
                        <span className="font-medium text-ink-900">{v}</span>
                      </div>
                    );
                  })}
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
      ) : loaded && !agent ? (
        /* ── 空态：服务商接口失败或地区暂无 ── */
        <section className="px-6 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
            <span className="text-3xl">🪧</span>
          </div>
          <div className="mt-4 text-serif-cn text-[15px] font-semibold text-ink-800">暂无可用积分服务商</div>
          <div className="mt-1.5 text-[12px] leading-5 text-ink-500">
            你所在地区还没有服务商，请稍后再试或联系客服
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-full bg-warm-50 px-4 py-1.5 text-[12px] text-ink-700"
          >
            重试 →
          </button>
        </section>
      ) : (
        /* ── 购买表单（即使 agent 未到也先显数量选择，不空等） ── */
        <section className="px-5">
          <div className="mb-3 text-serif-cn text-[14px] font-semibold text-ink-800">选择购买数量</div>
          <div className="grid grid-cols-2 gap-2.5">
            {PRESETS.map((v) => {
              const on = !custom && points === v;
              // 0028 显示客户法币 · 老 USD fallback
              const fiatLabel = userCurrency && currencies
                ? pointsToFiatLabel(v, userCurrency, currencies)
                : `$${((v * CENT_PER_POINT) / 100).toFixed(0)}`;
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
                    {fiatLabel}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-500">{v.toLocaleString()} 积分</div>
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

          {/* 收款方式选择（agent 未到 → 显占位骨架，到了无声替换） */}
          <div className="mb-2 mt-5 text-serif-cn text-[14px] font-semibold text-ink-800">向服务商支付方式</div>
          {!agent ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl border border-warm-100 bg-warm-50/60" />
              ))}
            </div>
          ) : hasMethods ? (
            <div className="space-y-2">
              {agent.paymentMethods.map((m) => {
                const on = methodId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethodId(m.id)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                      on ? 'border-primary bg-primary/5 shadow-warm-sm' : 'border-warm-100 bg-white'
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
          ) : (
            /* 有服务商但还没配收款方式 → 明确提示,不再留空白(治"选了数量却卡住且无解释") */
            <div className="rounded-2xl border border-warm-100 bg-warm-50/50 px-4 py-5 text-center">
              <div className="text-[13px] font-medium text-ink-700">服务商暂未配置收款方式</div>
              <div className="mt-1 text-[11px] leading-5 text-ink-500">请稍后再试,或联系客服帮你对接</div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-warm-50 px-4 py-3">
            <span className="text-[13px] text-ink-600">应付（约）</span>
            <span className="text-display text-xl font-bold text-primary num">{payLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-1.5 text-center text-[11px] leading-5 text-ink-400">
            <span className="rounded-full bg-warm-50 px-2 py-0.5 font-medium text-ink-500">汇率 {rateLabel}</span>
          </div>
          <div className="mt-1 text-center text-[11px] leading-5 text-ink-400">
            向服务商支付等值法币 · 实付以服务商收款方式为准
          </div>

          {/* 实付金额(可选):客户填真实转账金额,留作出纠纷时平台仲裁判责 */}
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-warm-100 bg-white px-4 py-3 shadow-warm-xs focus-within:border-primary">
            <span className="text-[12px] text-ink-400">实付</span>
            <input
              type="number"
              inputMode="decimal"
              value={localAmount}
              onChange={(e) => setLocalAmount(e.target.value)}
              placeholder={estLocalStr ? `约 ${estLocalStr}（可改）` : '你实付的金额'}
              className="flex-1 bg-transparent text-right text-[14px] text-ink-900 outline-none placeholder:text-ink-300"
            />
            <span className="text-[12px] text-ink-400">{localCurLabel}</span>
          </div>
          <div className="mt-1 text-center text-[10px] leading-4 text-ink-300">
            填你实际转给服务商的金额，万一出纠纷可凭它和凭证申诉
          </div>

          <div className="mt-5">
            <PrimaryButton onClick={placeOrder} disabled={!valid} loading={busy}>
              {!loaded
                ? '加载中…'
                : !agent
                  ? '暂无服务商'
                  : !hasMethods
                    ? '服务商暂未配置收款方式'
                    : !methodId
                      ? '请选择支付方式'
                      : !amountOk
                        ? minPts && amount < minPts
                          ? `最少购买 ${minPts.toLocaleString()} 积分`
                          : '请输入有效数量'
                        : '下单并获取收款方式'}
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
