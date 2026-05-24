'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull, PointsTag } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface Dashboard {
  orders: {
    total_orders: number;
    paid_orders: number;
    completed_orders: number;
    disputed_orders: number;
    gross_points: string;
  };
  tips: { net_tip_points: string; tip_count: number };
  reviews: { review_count: number; avg_score_service: number };
  earnings: null | {
    available_cents: string;
    pending_cents: string;
    tip_earnings_cents: string;
    invite_rewards_cents: string;
  };
}

export default function TherapistHomePage() {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    void (async () => {
      const d = await apiGet<Dashboard>('/dashboard/therapist/me');
      setData(d);
    })();
  }, []);

  if (!data) return <TherapistShell title="主页"><LoadingFull /></TherapistShell>;

  const available = parseInt(data.earnings?.available_cents ?? '0', 10);
  const pending = parseInt(data.earnings?.pending_cents ?? '0', 10);

  return (
    <TherapistShell title="主页">
      <div className="bg-gradient-soft px-5 py-5">
        {/* 收益大卡 · 渐变 */}
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">AVAILABLE BALANCE</div>
          <div className="mt-1 flex items-end gap-1.5">
            <span className="text-display text-4xl font-bold num">${(available / 100).toFixed(2)}</span>
            <span className="pb-1 text-xs text-white/70">USD</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-white/85">
            <span>
              处理中{' '}
              <span className="text-display font-bold text-white num">
                ${(pending / 100).toFixed(2)}
              </span>
            </span>
            <Link
              href="/t/me/earnings"
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur transition active:scale-95"
            >
              申请提现 →
            </Link>
          </div>
        </div>

        {/* 4 栏 KPI */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="ORDERS" zh="近 30 天" value={data.orders.total_orders} accent />
          <Stat label="COMPLETED" zh="已完成" value={data.orders.completed_orders} />
          <Stat label="TIPS" zh="收到小费" value={data.tips.tip_count} />
          <Stat label="REVIEWS" zh="评价数" value={data.reviews.review_count} />
        </div>

        {/* 收入构成 */}
        <div className="mt-4 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
          <div className="mb-1 text-serif-cn text-sm font-semibold text-ink-800">收入构成</div>
          <div className="label-cormorant mb-3">REVENUE BREAKDOWN · 30 DAYS</div>
          <div className="space-y-2.5 text-sm">
            <Row label="订单总额" value={<PointsTag points={parseInt(data.orders.gross_points ?? '0', 10)} />} />
            <Row label="小费净收" value={<PointsTag points={parseInt(data.tips.net_tip_points ?? '0', 10)} />} />
          </div>
        </div>

        {/* 评分 */}
        <div className="mt-4 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-serif-cn text-sm font-semibold text-ink-800">服务分</div>
              <div className="label-cormorant">SERVICE RATING</div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-warning-500">★</span>
              <span className="text-display text-2xl font-bold text-ink-800 num">
                {(data.reviews.avg_score_service / 10).toFixed(1)}
              </span>
            </div>
          </div>
          {data.orders.disputed_orders > 0 && (
            <Link
              href="/t/orders?status=disputed"
              className="mt-3 flex items-center justify-between rounded-xl bg-danger-500/10 px-3 py-2 text-xs text-danger-500"
            >
              <span>⚠ 有 {data.orders.disputed_orders} 单争议中</span>
              <span>处理 →</span>
            </Link>
          )}
        </div>
      </div>
    </TherapistShell>
  );
}

function Stat({ label, zh, value, accent }: { label: string; zh: string; value: number | string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-warm-xs ${
        accent ? 'border-warm-200' : 'border-warm-100'
      }`}
    >
      <div className="text-display text-2xl font-bold text-ink-800 num">{value}</div>
      <div className="mt-1 text-xs text-ink-600">{zh}</div>
      <div className="label-cormorant mt-0.5 text-[9px]">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-600">{label}</span>
      {value}
    </div>
  );
}
