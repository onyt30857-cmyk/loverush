'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PointsTag, PrimaryButton, GhostButton } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  customerId: string;
  therapistUserId: string;
  pricePoints: number;
  serviceSnapshot: { skills: string[]; durationMin: number };
  paidAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  customerRating?: number | null;
  scheduledAt: string | null;
  // 0027 法币模式 · 老积分订单为 null
  currencyCode: string | null;
  totalFiat: string | null;
  depositPoints: number | null;
  depositStatus: string | null;
  offlinePaidAt: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_CONFIRM: '等待技师确认',
  LOCKED: '已锁价，待支付',
  PAID: '已支付，待开始',
  IN_SERVICE: '服务进行中',
  COMPLETED: '已完成，待评价',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
  DISPUTED: '申诉中',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  // 0027 · /currencies 字典 · 心动金积分→法币换算
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);
  useEffect(() => {
    void (async () => {
      try { setCurrencies(await apiGet<CurrencyMini[]>('/currencies')); } catch {}
    })();
  }, []);

  async function load() {
    try {
      const data = await apiGet<Order>(`/orders/${id}`);
      setOrder(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(path, body);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <AppShell title="订单" showBack hideTabBar>
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </AppShell>
    );
  }

  const isFiatMode = !!order.currencyCode;
  // 时段后 30min · LOCKED/PAID 状态才能客户标 [技师没来]
  const scheduledMs = order.scheduledAt ? new Date(order.scheduledAt).getTime() : null;
  const minutesPastScheduled = scheduledMs ? (Date.now() - scheduledMs) / 60_000 : null;
  const canMarkTherapistNoShow =
    isFiatMode &&
    ['LOCKED', 'PAID'].includes(order.status) &&
    minutesPastScheduled != null &&
    minutesPastScheduled > 30;

  return (
    <AppShell title={`订单 ${order.orderNo}`} showBack hideTabBar>
      <div className="bg-gradient-soft px-5 py-5">
        {/* 大状态卡 */}
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">ORDER STATUS</div>
          <div className="mt-1 text-serif-cn text-2xl font-bold">
            {STATUS_TEXT[order.status] ?? order.status}
          </div>
          <div className="mt-5 flex items-end justify-between">
            <div>
              {isFiatMode ? (
                <>
                  <div className="text-display text-4xl font-bold num">{order.currencyCode} {order.totalFiat}</div>
                  <div className="mt-0.5 text-[10px] text-white/70">线下面付 · 服务时给技师</div>
                </>
              ) : (
                <>
                  <div className="text-display text-4xl font-bold num">{order.pricePoints}</div>
                  <div className="mt-0.5 text-[10px] text-white/70">积分</div>
                </>
              )}
            </div>
            <div className="text-right text-[11px] text-white/80">
              <div className="text-display text-lg font-bold num">{order.serviceSnapshot.durationMin}</div>
              <div className="mt-0.5">分钟</div>
            </div>
          </div>
          {order.depositStatus && order.depositPoints != null && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white/15 px-3 py-2">
              <span className="text-[11px] text-white/90">心动金 · 平台冻结</span>
              <span className="text-[13px] font-semibold">{pointsToFiatLabel(order.depositPoints, order.currencyCode, currencies)}</span>
            </div>
          )}
        </div>

        {order.serviceSnapshot.skills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {order.serviceSnapshot.skills.map((s) => (
              <span key={s} className="rounded-full border border-warm-200 bg-white px-2.5 py-0.5 text-xs text-warm-700">
                {s}
              </span>
            ))}
          </div>
        )}

        <ErrorBanner message={error} />

        {/* 客户视角的可用动作 · 法币 LOCKED 等技师线下收款,客户无操作;只有时段过 30min 才能标技师没来 */}
        {order.status === 'LOCKED' && isFiatMode && (
          <div className="mt-6 space-y-2">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-center text-sm text-emerald-800">
              <div className="mb-1 font-semibold">已锁定时段 · 等待面对面服务</div>
              <div className="text-[11px] leading-5 text-emerald-700/85">
                服务时面付现金/转账给技师 · 心动金已平台冻结 · 服务完成自动退还
              </div>
            </div>
            {canMarkTherapistNoShow && (
              <GhostButton onClick={() => void act(`/orders/${order.id}/therapist-no-show`)}>
                技师没来(全退心动金)
              </GhostButton>
            )}
            <GhostButton onClick={() => void act(`/orders/${order.id}/cancel`, { reason: '不想要了' })}>
              取消订单
            </GhostButton>
          </div>
        )}
        {order.status === 'LOCKED' && !isFiatMode && (
          <div className="mt-6">
            <PrimaryButton
              onClick={() => void act(`/orders/${order.id}/pay`, { payment_txn_id: `stub_${Date.now()}` })}
              loading={busy}
            >
              确认支付 <PointsTag points={order.pricePoints} />
            </PrimaryButton>
            <div className="mt-2">
              <GhostButton onClick={() => void act(`/orders/${order.id}/cancel`, { reason: '不想要了' })}>
                取消订单
              </GhostButton>
            </div>
          </div>
        )}

        {/* PAID + 时段过 · 客户可标技师没来 */}
        {order.status === 'PAID' && canMarkTherapistNoShow && (
          <div className="mt-6">
            <GhostButton onClick={() => void act(`/orders/${order.id}/therapist-no-show`)}>
              技师没来(全退心动金)
            </GhostButton>
          </div>
        )}

        {order.status === 'PENDING_CONFIRM' && (
          <div className="mt-6 text-center text-sm text-ink-500">
            技师将在 5 分钟内回应…
            <div className="mt-3">
              <GhostButton onClick={() => void act(`/orders/${order.id}/cancel`, { reason: '不等了' })}>取消订单</GhostButton>
            </div>
          </div>
        )}

        {order.status === 'COMPLETED' && !reviewMode && (
          <div className="mt-6">
            <PrimaryButton onClick={() => setReviewMode(true)}>评价服务</PrimaryButton>
          </div>
        )}

        {order.status === 'COMPLETED' && reviewMode && (
          <div className="mt-6 space-y-3 rounded-2xl border border-warm-100 bg-white p-5 shadow-warm-md">
            <div className="text-center">
              <div className="text-serif-cn text-base font-semibold text-ink-800">服务怎么样？</div>
              <div className="label-cormorant mt-1">RATE YOUR EXPERIENCE</div>
            </div>
            <div className="flex justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className={`text-4xl transition active:scale-90 ${n <= rating ? 'text-warning-500 drop-shadow' : 'text-ink-200'}`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              className="h-24 w-full rounded-xl border border-warm-100 bg-warm-50 p-3 text-sm placeholder:text-ink-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="说点什么（可选）"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
            />
            <PrimaryButton
              loading={busy}
              onClick={async () => {
                await act(`/orders/${order.id}/review`, { rating, review: reviewText || undefined });
                // 同步写 reviews 表（带三维评分 · 默认服务分 = rating × 20）
                try {
                  await apiPost('/reviews', {
                    order_id: order.id,
                    score_service: rating * 20,
                    content: reviewText || undefined,
                  });
                } catch {}
                setReviewMode(false);
              }}
            >
              提交评价
            </PrimaryButton>
          </div>
        )}

        {order.status === 'IN_SERVICE' && (
          <div className="mt-6 rounded-2xl border border-warm-100 bg-white p-4 text-center shadow-warm-sm">
            <div className="text-2xl">💆‍♀️</div>
            <div className="mt-2 text-serif-cn text-sm font-medium text-ink-800">服务进行中…</div>
            <div className="label-cormorant mt-1">IN SERVICE</div>
          </div>
        )}

        {['REVIEWED', 'CANCELLED', 'REFUNDED', 'CLOSED'].includes(order.status) && (
          <div className="mt-6 rounded-2xl bg-white p-4 text-center text-sm text-ink-600 shadow-warm-xs">
            订单已结束
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push(`/order/${order.id}/chain`)}
          className="mt-8 flex w-full items-center justify-between rounded-2xl border border-warm-100 bg-white px-4 py-3 text-sm text-ink-700 shadow-warm-xs transition active:scale-[0.99]"
        >
          <span className="flex items-center gap-2">
            <span>🔗</span>
            <span>查看凭证链</span>
          </span>
          <span className="label-cormorant">CHAIN PROOF →</span>
        </button>
      </div>
    </AppShell>
  );
}
