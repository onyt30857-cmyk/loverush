'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import { CustomerBottomNav } from '@/components/BottomNav';
import { apiGet } from '@/lib/api';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';
import { apptLocalDate, absLabel } from '@/lib/appointment-time';
import Loading from './loading';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  pricePoints: number;
  therapistId: string;
  therapistName: string | null;
  therapistAvatarUrl: string | null;
  serviceSnapshot: { skills: string[]; durationMin: number };
  createdAt: string;
  // 0027 法币模式 · 老积分订单为 null
  currencyCode: string | null;
  totalFiat: string | null;
  depositPoints: number | null;
  depositStatus: string | null;
  // 后端 listOrders 注入:老订单法币即时估算标记
  fiatEstimated?: boolean;
  scheduledAt?: string | null;
}

const DEPOSIT_BADGE: Record<string, { label: string; cls: string }> = {
  HOLDING: { label: '心动金冻结', cls: 'bg-blue-50 text-blue-700' },
  RELEASED: { label: '心动金已退', cls: 'bg-emerald-50 text-emerald-700' },
  FORFEITED_TO_THERAPIST: { label: '心动金扣留', cls: 'bg-orange-50 text-orange-700' },
  FORFEITED_TO_PLATFORM: { label: '心动金扣留', cls: 'bg-orange-50 text-orange-700' },
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

export default function CustomerOrdersPage() {
  const router = useRouter();
  // SWR 缓存:二次进站显旧数据 + 后台 revalidate;错误降级为空数组
  const { data, error } = useSWR<Order[]>('/orders?role=customer&limit=50');
  const list = error ? [] : data ?? null;
  const [tab, setTab] = useState<'active' | 'history' | 'all'>('active');
  // 0027 · 拉公开 currencies 字典 · 用于积分→技师法币换算
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);
  useEffect(() => {
    void (async () => {
      try { setCurrencies(await apiGet<CurrencyMini[]>('/currencies')); } catch {}
    })();
  }, []);

  if (!list) return <Loading />;

  const filtered =
    tab === 'active'
      ? list.filter((o) => ACTIVE.includes(o.status))
      : tab === 'history'
      ? list.filter((o) => !ACTIVE.includes(o.status))
      : list;

  return (
    <div className="mobile-container bg-gradient-soft">
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

      <section
        className={`px-4 ${
          filtered.length === 0 ? 'flex flex-1 flex-col items-center justify-center pb-24' : 'pt-3'
        }`}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
              <Inbox className="h-7 w-7 text-warm-400" />
            </div>
            <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">
              {tab === 'active' ? '当前没有进行中订单' : tab === 'history' ? '还没有历史订单' : '还没有订单'}
            </div>
            <div className="mt-1.5 text-[12px] text-ink-500">
              先去发现页挑一位技师,然后预约你喜欢的服务
            </div>
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
                    <div className="flex min-w-0 items-center gap-2.5">
                      {o.therapistAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={o.therapistAvatarUrl}
                          alt={o.therapistName ?? '技师'}
                          className="h-10 w-10 flex-shrink-0 rounded-full object-cover ring-1 ring-warm-100"
                        />
                      ) : (
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-cta text-sm font-semibold text-white">
                          {o.therapistName?.[0] ?? '技'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-serif-cn text-base font-semibold text-ink-900">
                          {o.serviceSnapshot.durationMin} 分钟服务
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-ink-500">
                          {o.therapistName ? `${o.therapistName} · ` : ''}
                          {o.serviceSnapshot.skills.join(' · ') || '基础套餐'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {o.totalFiat != null ? (
                        <>
                          <div className="num font-display text-lg font-semibold text-primary">
                            {o.fiatEstimated && '≈ '}{o.currencyCode} {o.totalFiat}
                          </div>
                          <div className="text-[9px] text-ink-500">{o.fiatEstimated ? '按现价估算' : '线下面付'}</div>
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
                          DEPOSIT_BADGE[o.depositStatus]?.cls ?? 'bg-gray-50 text-gray-700'
                        }`}
                      >
                        {DEPOSIT_BADGE[o.depositStatus]?.label ?? o.depositStatus}
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

      <CustomerBottomNav active="orders" />
    </div>
  );
}
