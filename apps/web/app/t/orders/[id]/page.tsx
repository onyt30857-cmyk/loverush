'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PointsTag, PrimaryButton, GhostButton } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  pricePoints: number;
  customerId: string;
  serviceSnapshot: { skills: string[]; durationMin: number };
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

  return (
    <TherapistShell title={order.orderNo} showBack hideTabBar>
      <div className="px-5 py-5">
        <div className="rounded-2xl bg-gradient-to-br from-primary to-warm-500 p-5 text-white">
          <div className="text-xs opacity-80">状态</div>
          <div className="mt-1 text-xl font-bold">{STATUS_TEXT[order.status] ?? order.status}</div>
          <div className="mt-4 flex items-end justify-between">
            <div className="text-3xl font-bold">{order.pricePoints}</div>
            <div className="text-xs opacity-80">{order.serviceSnapshot.durationMin} 分钟</div>
          </div>
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

        <ErrorBanner message={error} />

        {/* 技师视角动作 */}
        {order.status === 'PENDING_CONFIRM' && (
          <div className="mt-6 space-y-2">
            <PrimaryButton loading={busy} onClick={() => void act(`/orders/${order.id}/confirm`)}>
              确认 · 锁价 <PointsTag points={order.pricePoints} />
            </PrimaryButton>
            <GhostButton onClick={() => void act(`/orders/${order.id}/cancel`, { reason: '不方便接' })}>
              拒绝
            </GhostButton>
          </div>
        )}

        {order.status === 'PAID' && (
          <div className="mt-6">
            <PrimaryButton loading={busy} onClick={() => void act(`/orders/${order.id}/start`)}>
              开始服务
            </PrimaryButton>
          </div>
        )}

        {order.status === 'IN_SERVICE' && (
          <div className="mt-6">
            <PrimaryButton loading={busy} onClick={() => void act(`/orders/${order.id}/complete`)}>
              标记完成
            </PrimaryButton>
          </div>
        )}

        {order.status === 'LOCKED' && (
          <div className="mt-6 text-center text-sm text-ink-500">等待客户支付…</div>
        )}

        {['COMPLETED', 'REVIEWED', 'CANCELLED', 'REFUNDED', 'CLOSED'].includes(order.status) && (
          <div className="mt-6 text-center text-sm text-ink-500">订单已结束</div>
        )}
      </div>
    </TherapistShell>
  );
}
