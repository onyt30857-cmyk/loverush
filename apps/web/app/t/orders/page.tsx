'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Inbox, CalendarDays } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { LoadingFull } from '@/components/ui';
import { SwipeableTabs, type SwipeTab } from '@/components/ui/SwipeableTabs';
import { apptLocalDate, absLabel } from '@/lib/appointment-time';
import { TherapistBottomNav } from '@/components/BottomNav';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  pricePoints: number;
  customerId: string;
  serviceSnapshot: { skills: string[]; durationMin: number };
  createdAt: string;
  // 0027 法币模式
  currencyCode: string | null;
  totalFiat: string | null;
  depositPoints: number | null;
  depositStatus: string | null;
  offlinePaidAt: string | null;
  scheduledAt?: string | null;
  // 回头客识别(锚定该技师)
  customerName?: string | null;
  isRepeatCustomer?: boolean;
  visitCount?: number;
  lastVisitAt?: string | null;
  noShowCount?: number;
}

/** 距上次到访天数文案 */
function lastVisitLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return '今天来过';
  if (days === 1) return '昨天来过';
  if (days < 30) return `上次 ${days} 天前`;
  if (days < 365) return `上次 ${Math.floor(days / 30)} 个月前`;
  return '很久没来了';
}

const DEPOSIT_BADGE_T: Record<string, { label: string; cls: string }> = {
  HOLDING: { label: '心动金冻结', cls: 'bg-blue-50 text-blue-700' },
  RELEASED: { label: '心动金已退', cls: 'bg-emerald-50 text-emerald-700' },
  FORFEITED_TO_THERAPIST: { label: '已收 50% 分账', cls: 'bg-orange-50 text-orange-700' },
  FORFEITED_TO_PLATFORM: { label: '心动金扣留', cls: 'bg-gray-50 text-gray-700' },
  REFUNDED: { label: '心动金全退', cls: 'bg-gray-50 text-gray-700' },
};

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

type OrderTab = 'active' | 'all' | 'history';
const TAB_KEYS: readonly OrderTab[] = ['active', 'history', 'all'];
const TABS: SwipeTab[] = [
  { key: 'active', label: '进行中' },
  { key: 'history', label: '历史' },
  { key: 'all', label: '全部' },
];

const EMPTY_TITLE: Record<OrderTab, string> = {
  active: '当前没有进行中订单',
  history: '还没有历史订单',
  all: '还没有订单',
};

/** 单个订单卡片(含客户/回头客/爽约信号) */
function OrderCard({
  o,
  currencies,
  onClick,
}: {
  o: Order;
  currencies: CurrencyMini[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-warm-100 bg-white p-4 text-left shadow-warm-xs transition active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <span className="font-cormorant italic text-[10px] tracking-wider text-ink-500">{o.orderNo}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            STATUS_TONE[o.status] ?? 'bg-ink-100 text-ink-500'
          }`}
        >
          {STATUS_TEXT[o.status] ?? o.status}
        </span>
      </div>
      {/* 客户 + 回头客识别(锚定该技师:完成过≥1单=老客) */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-800">{o.customerName ?? '客户'}</span>
        {o.isRepeatCustomer ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            老客{o.visitCount && o.visitCount > 1 ? ` · 第${o.visitCount}次` : ''}
          </span>
        ) : (
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-500">新客</span>
        )}
        {o.isRepeatCustomer && lastVisitLabel(o.lastVisitAt) && (
          <span className="text-[10px] text-ink-400">{lastVisitLabel(o.lastVisitAt)}</span>
        )}
        {!!o.noShowCount && o.noShowCount > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
            ⚠️ 爽约 {o.noShowCount} 次
          </span>
        )}
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
          {o.currencyCode && o.totalFiat ? (
            <>
              <div className="num font-display text-lg font-semibold text-primary">
                {o.currencyCode} {o.totalFiat}
              </div>
              <div className="text-[9px] text-ink-500">线下应收</div>
            </>
          ) : (
            <>
              <div className="num font-display text-lg font-semibold text-primary">{o.pricePoints}</div>
              <div className="text-[9px] text-ink-500">积分</div>
            </>
          )}
        </div>
      </div>
      {o.depositStatus && o.depositPoints != null && (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              DEPOSIT_BADGE_T[o.depositStatus]?.cls ?? 'bg-gray-50 text-gray-700'
            }`}
          >
            {DEPOSIT_BADGE_T[o.depositStatus]?.label ?? o.depositStatus}
          </span>
          <span className="text-[10px] text-ink-500">
            {pointsToFiatLabel(o.depositPoints, o.currencyCode, currencies)}
          </span>
        </div>
      )}
      {o.scheduledAt && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-500">
          <span>📅</span>
          <span>预约 {absLabel(apptLocalDate(o.scheduledAt))}</span>
        </div>
      )}
    </button>
  );
}

/** 单个 tab 面板:列表或空态 */
function OrderPanel({
  orders,
  tab,
  currencies,
  onOpen,
}: {
  orders: Order[];
  tab: OrderTab;
  currencies: CurrencyMini[];
  onOpen: (id: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
          <Inbox className="h-7 w-7 text-warm-400" />
        </div>
        <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">{EMPTY_TITLE[tab]}</div>
        <div className="mt-1.5 text-[11px] text-ink-500">保持在线 · 让客户能找到你</div>
        <Link
          href="/t/home"
          className="mt-4 rounded-full bg-gradient-cta px-5 py-2 text-[12px] font-medium text-white shadow-warm-md active:scale-95"
        >
          返回工作台
        </Link>
      </div>
    );
  }
  return (
    <section className="px-4 pt-3 pb-2">
      <ul className="space-y-2.5">
        {orders.map((o) => (
          <li key={o.id}>
            <OrderCard o={o} currencies={currencies} onClick={() => onOpen(o.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TherapistOrdersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 顶部「完成单数」等入口可带 ?tab=history 直接落到历史单
  const tabParam = searchParams.get('tab');
  const initialTab: OrderTab = TAB_KEYS.includes(tabParam as OrderTab) ? (tabParam as OrderTab) : 'active';
  const [list, setList] = useState<Order[] | null>(null);
  const [tab, setTab] = useState<OrderTab>(initialTab);
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await apiGet<Order[]>('/orders?role=therapist&limit=50');
        setList(rows);
      } catch {
        setList([]);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setCurrencies(await apiGet<CurrencyMini[]>('/currencies'));
      } catch {}
    })();
  }, []);

  if (!list) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <LoadingFull />
      </div>
    );
  }

  const activeList = list.filter((o) => ACTIVE.includes(o.status));
  const historyList = list.filter((o) => !ACTIVE.includes(o.status));
  const onOpen = (id: string) => router.push(`/t/orders/${id}`);

  return (
    <div className="mobile-container bg-gradient-soft">
      <div className="flex items-center justify-between bg-white px-4 pt-3 pb-2">
        <h1 className="text-[16px] font-semibold text-ink-900">我的订单</h1>
        <Link
          href="/t/me/calendar"
          className="flex items-center gap-1 rounded-full bg-warm-50 px-3 py-1.5 text-[12px] font-medium text-primary active:bg-warm-100"
        >
          <CalendarDays className="h-3.5 w-3.5" />经营日历
        </Link>
      </div>

      <SwipeableTabs
        tabs={TABS}
        value={tab}
        onChange={(k) => setTab(k as OrderTab)}
        variant="underline"
        tabBarClassName="sticky top-0 z-20 border-b border-warm-100 bg-white"
      >
        <OrderPanel orders={activeList} tab="active" currencies={currencies} onOpen={onOpen} />
        <OrderPanel orders={historyList} tab="history" currencies={currencies} onOpen={onOpen} />
        <OrderPanel orders={list} tab="all" currencies={currencies} onOpen={onOpen} />
      </SwipeableTabs>

      <TherapistBottomNav active="orders" />
    </div>
  );
}

// useSearchParams 必须包 Suspense,否则 SSG prerender 失败 build 挂
export default function TherapistOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="mobile-container bg-gradient-soft">
          <LoadingFull />
        </div>
      }
    >
      <TherapistOrdersPageInner />
    </Suspense>
  );
}
