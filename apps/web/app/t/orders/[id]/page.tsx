'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PointsTag, PrimaryButton, GhostButton } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';
import {
  CustomerLocationView,
  type CustomerLocationMediaItem,
} from '@/components/location/CustomerLocationView';
import { apptLocalDate, absLabel, countdownLabel } from '@/lib/appointment-time';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  pricePoints: number;
  customerId: string;
  customerName?: string | null;
  serviceSnapshot: { skills: string[]; durationMin: number };
  scheduledAt: string | null;
  // 0027 法币模式
  currencyCode: string | null;
  totalFiat: string | null;
  depositPoints: number | null;
  depositStatus: string | null;
  offlinePaidAt: string | null;
  // 上门服务 · 客户上门地址(后端 viewer-aware · 确认前 full=false 只给区域+距离 · LOCKED 后 full=true)
  customerLocation?: {
    areaName: string | null;
    address: string | null;
    note: string | null;
    media: CustomerLocationMediaItem[];
    distanceKm: number | null;
    lat?: string | null;
    lng?: string | null;
    full: boolean;
  } | null;
}

const STATUS_TEXT: Record<string, string> = {
  PENDING_CONFIRM: '待你确认 · 锁价',
  LOCKED: '已锁价，等待客户支付',
  PAID: '已支付，可开始服务',
  IN_SERVICE: '服务进行中',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
  DISPUTED: '争议处理中',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

export default function TherapistOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 0027 · 心动金积分→法币换算
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);
  useEffect(() => {
    void (async () => {
      try { setCurrencies(await apiGet<CurrencyMini[]>('/currencies')); } catch {}
    })();
  }, []);

  async function load() {
    try {
      setOrder(await apiGet<Order>(`/orders/${id}`));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 每分钟刷新 · 让倒计时是活的（hook 必须在所有 early return 之前）
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      await apiPost(path, body);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (!order) return <TherapistShell title="订单" showBack hideTabBar><LoadingFull /></TherapistShell>;

  const isFiatMode = !!order.currencyCode;
  // 预约时间展示
  const apptDate = order.scheduledAt ? apptLocalDate(order.scheduledAt) : null;
  const apptAbs = apptDate ? absLabel(apptDate) : null;
  const apptCountdown = apptDate ? countdownLabel(apptDate, nowTick, order.customerName ?? '客户') : null;
  // 时段后 30min · LOCKED/PAID 状态才能标 [客户没来]
  const scheduledMs = order.scheduledAt ? new Date(order.scheduledAt).getTime() : null;
  const minutesPastScheduled = scheduledMs ? (Date.now() - scheduledMs) / 60_000 : null;
  const canMarkCustomerNoShow =
    isFiatMode &&
    ['LOCKED', 'PAID'].includes(order.status) &&
    minutesPastScheduled != null &&
    minutesPastScheduled > 30;

  return (
    <TherapistShell title={order.orderNo} showBack hideTabBar>
      <div className="px-5 py-5">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-warm-500 p-5 text-white">
          <div className="text-xs opacity-80">状态</div>
          <div className="mt-1 text-xl font-bold">{STATUS_TEXT[order.status] ?? order.status}</div>
          <div className="mt-4 flex items-end justify-between">
            <div>
              {isFiatMode ? (
                <>
                  <div className="text-3xl font-bold">{order.currencyCode} {order.totalFiat}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">线下应收 · 现金/转账</div>
                </>
              ) : (
                <div className="text-3xl font-bold">{order.pricePoints}</div>
              )}
            </div>
            <div className="text-xs opacity-80">{order.serviceSnapshot.durationMin} 分钟</div>
          </div>
          {order.depositStatus && order.depositPoints != null && (
            <div className="mt-3 flex items-center gap-2 text-[11px] opacity-90">
              <span>心动金 {pointsToFiatLabel(order.depositPoints, order.currencyCode, currencies)}</span>
              <span className="rounded bg-white/20 px-1.5 py-0.5">{order.depositStatus}</span>
            </div>
          )}
          {apptAbs && (
            <div className="mt-3 rounded-lg bg-white/15 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span>📅</span>
                <span className="font-medium">预约时间 {apptAbs}</span>
              </div>
              {apptCountdown && (
                <div className="mt-0.5 text-[11px] opacity-80">{apptCountdown}</div>
              )}
            </div>
          )}
        </div>

        {order.serviceSnapshot.skills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {order.serviceSnapshot.skills.map((s) => (
              <span key={s} className="rounded-full bg-ink-50 px-2 py-0.5 text-xs text-ink-700">
                {s}
              </span>
            ))}
          </div>
        )}

        {/* 上门服务 · 客户上门地址(确认前只显区域+距离 · LOCKED 后完整+导航) */}
        {order.customerLocation && (
          <div className="mt-4 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-serif-cn text-[15px] font-semibold text-ink-900">客户上门地址</div>
                <div className="label-cormorant mt-0.5">CUSTOMER ADDRESS</div>
              </div>
              <span className="text-xl">🏠</span>
            </div>
            <CustomerLocationView
              info={{
                areaName: order.customerLocation.areaName,
                address: order.customerLocation.address,
                note: order.customerLocation.note,
                media: Array.isArray(order.customerLocation.media) ? order.customerLocation.media : [],
                distanceKm: order.customerLocation.distanceKm,
                lat: order.customerLocation.lat,
                lng: order.customerLocation.lng,
                full: order.customerLocation.full,
              }}
            />
          </div>
        )}

        <ErrorBanner message={error} />

        {/* 技师视角动作 */}
        {order.status === 'PENDING_CONFIRM' && (
          <div className="mt-6 space-y-2">
            <PrimaryButton loading={busy} onClick={() => void act(`/orders/${order.id}/confirm`)}>
              {isFiatMode
                ? `确认接单 · 锁价 ${order.currencyCode} ${order.totalFiat}`
                : <>确认 · 锁价 <PointsTag points={order.pricePoints} /></>}
            </PrimaryButton>
            <GhostButton onClick={() => void act(`/orders/${order.id}/cancel`, { reason: '不方便接' })}>
              拒绝
            </GhostButton>
          </div>
        )}

        {order.status === 'PAID' && (
          <div className="mt-6 space-y-2">
            <PrimaryButton loading={busy} onClick={() => void act(`/orders/${order.id}/start`)}>
              开始服务
            </PrimaryButton>
            {canMarkCustomerNoShow && (
              <GhostButton onClick={() => void act(`/orders/${order.id}/customer-no-show`)}>
                客户没来(扣留心动金 50% 给你)
              </GhostButton>
            )}
          </div>
        )}

        {order.status === 'IN_SERVICE' && (
          <div className="mt-6">
            <PrimaryButton loading={busy} onClick={() => void act(`/orders/${order.id}/complete`)}>
              标记完成
            </PrimaryButton>
          </div>
        )}

        {/* 0027 法币模式 · LOCKED 改成 [确认线下已收款] · 不依赖客户在线支付 */}
        {order.status === 'LOCKED' && isFiatMode && (
          <div className="mt-6 space-y-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-[11px] text-emerald-700">
              客户线下当面付现金/转账给你 · 收到全款后按下方按钮确认
            </div>
            <PrimaryButton
              loading={busy}
              onClick={() => void act(`/orders/${order.id}/confirm-offline-paid`)}
            >
              确认已线下收款 {order.currencyCode} {order.totalFiat}
            </PrimaryButton>
            {canMarkCustomerNoShow && (
              <GhostButton onClick={() => void act(`/orders/${order.id}/customer-no-show`)}>
                客户没来(扣留心动金 50% 给你)
              </GhostButton>
            )}
          </div>
        )}
        {order.status === 'LOCKED' && !isFiatMode && (
          <div className="mt-6 text-center text-sm text-ink-500">等待客户支付…</div>
        )}

        {['COMPLETED', 'REVIEWED', 'CANCELLED', 'REFUNDED', 'CLOSED'].includes(order.status) && (
          <div className="mt-6 text-center text-sm text-ink-500">订单已结束</div>
        )}
      </div>
    </TherapistShell>
  );
}
