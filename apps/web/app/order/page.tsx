'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { LoadingFull } from '@/components/ui';
import { CustomerBottomNav } from '@/components/BottomNav';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  pricePoints: number;
  therapistId: string;
  serviceSnapshot: { skills: string[]; durationMin: number };
  createdAt: string;
}

const STATUS_TEXT: Record<string, string> = {
  PENDING_CONFIRM: '待确认',
  LOCKED: '待支付',
  PAID: '待开始',
  IN_SERVICE: '服务中',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
  DISPUTED: '争议中',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

const STATUS_TONE: Record<string, string> = {
  PENDING_CONFIRM: 'bg-warning-500/15 text-warning-500',
  LOCKED: 'bg-warning-500/15 text-warning-500',
  PAID: 'bg-emerald-500/15 text-emerald-600',
  IN_SERVICE: 'bg-primary/15 text-primary',
  COMPLETED: 'bg-ink-100 text-ink-700',
  REVIEWED: 'bg-ink-100 text-ink-700',
  CANCELLED: 'bg-ink-100 text-ink-500',
  DISPUTED: 'bg-rose-500/15 text-rose-600',
  REFUNDED: 'bg-ink-100 text-ink-500',
  CLOSED: 'bg-ink-100 text-ink-500',
};

const ACTIVE = ['PENDING_CONFIRM', 'LOCKED', 'PAID', 'IN_SERVICE'];

export default function CustomerOrdersPage() {
  const router = useRouter();
  const [list, setList] = useState<Order[] | null>(null);
  const [tab, setTab] = useState<'active' | 'history' | 'all'>('active');

  useEffect(() => {
    void (async () => {
      try {
        const rows = await apiGet<Order[]>('/orders?role=customer&limit=50');
        setList(rows);
      } catch {
        setList([]);
      }
    })();
  }, []);

  if (!list) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <LoadingFull />
      </div>
    );
  }

  const filtered =
    tab === 'active'
      ? list.filter((o) => ACTIVE.includes(o.status))
      : tab === 'history'
      ? list.filter((o) => !ACTIVE.includes(o.status))
      : list;

  return (
    <div className="mobile-container bg-gradient-soft">
      <header className="sticky top-0 z-30 flex items-center bg-white/85 px-4 py-3 backdrop-blur-md">
        <div className="flex-1">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">我的预约</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">MY ORDERS</div>
        </div>
      </header>

      <div className="sticky top-14 z-20 grid grid-cols-3 border-b border-warm-100 bg-white">
        {(['active', 'history', 'all'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`relative py-3 text-[13px] font-medium transition ${
              tab === k ? 'text-primary' : 'text-ink-500'
            }`}
          >
            {k === 'active' ? '进行中' : k === 'history' ? '历史' : '全部'}
            {tab === k && (
              <span className="absolute inset-x-1/4 bottom-0 h-0.5 rounded-full bg-gradient-cta" />
            )}
          </button>
        ))}
      </div>

      <section className="px-4 pt-3">
        {filtered.length === 0 ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
              <Inbox className="h-7 w-7 text-warm-400" />
            </div>
            <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">
              {tab === 'active' ? '当前没有进行中订单' : tab === 'history' ? '还没有历史订单' : '还没有订单'}
            </div>
            <div className="mt-1.5 text-[11px] text-ink-500">去发现页找个技师吧</div>
            <Link
              href="/home"
              className="mt-4 rounded-full bg-gradient-cta px-5 py-2 text-[12px] font-medium text-white shadow-warm-md active:scale-95"
            >
              去发现
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/order/${o.id}`)}
                  className="w-full rounded-2xl border border-warm-100 bg-white p-4 text-left shadow-warm-xs transition active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-cormorant italic text-[10px] tracking-wider text-ink-500">
                      {o.orderNo}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        STATUS_TONE[o.status] ?? 'bg-ink-100 text-ink-500'
                      }`}
                    >
                      {STATUS_TEXT[o.status] ?? o.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <div className="text-serif-cn text-base font-semibold text-ink-900">
                        {o.serviceSnapshot.durationMin} 分钟服务
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-500">
                        {o.serviceSnapshot.skills.join(' · ') || '基础套餐'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num font-display text-lg font-semibold text-primary">{o.pricePoints}</div>
                      <div className="text-[9px] text-ink-500">积分</div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CustomerBottomNav active="orders" />
    </div>
  );
}
