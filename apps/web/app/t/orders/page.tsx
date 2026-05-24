'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TherapistShell } from '@/components/AppShell';
import { EmptyState, LoadingFull, PointsTag } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  pricePoints: number;
  customerId: string;
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

const ACTIVE_STATUSES = ['PENDING_CONFIRM', 'LOCKED', 'PAID', 'IN_SERVICE'];

export default function TherapistOrdersPage() {
  const router = useRouter();
  const [list, setList] = useState<Order[] | null>(null);
  const [tab, setTab] = useState<'active' | 'all'>('active');

  useEffect(() => {
    // 暂没专门 /me/orders 列表，先用 dispatch offers 后跳订单详情；这里 placeholder 显示空
    // TODO: 添加 GET /me/orders 后端接口（按 therapistUserId）
    setList([]);
  }, []);

  if (!list) return <TherapistShell title="订单"><LoadingFull /></TherapistShell>;

  const filtered = tab === 'active' ? list.filter((o) => ACTIVE_STATUSES.includes(o.status)) : list;

  return (
    <TherapistShell title="订单" hideTabBar={false}>
      <div className="sticky top-12 z-10 grid grid-cols-2 border-b border-ink-100 bg-white">
        {(['active', 'all'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`py-2.5 text-sm ${tab === k ? 'border-b-2 border-primary font-medium text-primary' : 'text-ink-500'}`}
          >
            {k === 'active' ? '进行中' : '全部'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={tab === 'active' ? '当前没有进行中订单' : '还没有订单'}
          hint="去派单池接单试试"
          icon="📦"
        />
      ) : (
        <ul className="space-y-2 px-5 py-4">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => router.push(`/t/orders/${o.id}`)}
                className="w-full rounded-2xl border border-ink-100 bg-white p-3 text-left active:bg-ink-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-500">{o.orderNo}</span>
                  <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[10px] text-warm-700">
                    {STATUS_TEXT[o.status]}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm">{o.serviceSnapshot.durationMin} 分钟</span>
                  <PointsTag points={o.pricePoints} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </TherapistShell>
  );
}
