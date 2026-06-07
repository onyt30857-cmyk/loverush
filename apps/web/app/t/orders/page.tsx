'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Inbox,
  ArrowLeft,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { LoadingFull } from '@/components/ui';
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

export default function TherapistOrdersPage() {
  const router = useRouter();
  const [list, setList] = useState<Order[] | null>(null);
  const [tab, setTab] = useState<'active' | 'all' | 'history'>('active');
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
      try { setCurrencies(await apiGet<CurrencyMini[]>('/currencies')); } catch {}
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
      {/* === Tabs === */}
      <div className="sticky top-0 z-20 grid grid-cols-3 border-b border-warm-100 bg-white">
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

      {/* === List === */}
      <section className="px-4 pt-3">
        {filtered.length === 0 ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
              <Inbox className="h-7 w-7 text-warm-400" />
            </div>
            <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">
              {tab === 'active' ? '当前没有进行中订单' : tab === 'history' ? '还没有历史订单' : '还没有订单'}
            </div>
            <div className="mt-1.5 text-[11px] text-ink-500">
              保持在线 · 让客户能找到你
            </div>
            <Link
              href="/t/home"
              className="mt-4 rounded-full bg-gradient-cta px-5 py-2 text-[12px] font-medium text-white shadow-warm-md active:scale-95"
            >
              返回工作台
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/t/orders/${o.id}`)}
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
                      <span className="text-[10px] text-ink-500">{pointsToFiatLabel(o.depositPoints, o.currencyCode, currencies)}</span>
                    </div>
                  )}
                  {o.scheduledAt && (
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-500">
                      <span>📅</span>
                      <span>预约 {absLabel(apptLocalDate(o.scheduledAt))}</span>
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TherapistBottomNav active="orders" />
    </div>
  );
}
