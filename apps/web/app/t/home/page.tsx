'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Wallet,
  Star,
  TrendingUp,
  Calendar,
  User,
  ShoppingBag,
  Home as HomeIcon,
  Image as ImageIcon,
  DollarSign,
  Settings,
} from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import { LoadingFull } from '@/components/ui';
import { TherapistBottomNav } from '@/components/BottomNav';

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

const EMPTY_DASHBOARD: Dashboard = {
  orders: { total_orders: 0, paid_orders: 0, completed_orders: 0, disputed_orders: 0, gross_points: '0' },
  tips: { net_tip_points: '0', tip_count: 0 },
  reviews: { review_count: 0, avg_score_service: 0 },
  earnings: null,
};

export default function TherapistHomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [online, setOnline] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await apiGet<Dashboard>('/dashboard/therapist/me');
        setData(d);
      } catch {
        setData(EMPTY_DASHBOARD); // 失败也退出 loading，渲染空骨架而非永久白屏
      }
      try {
        const me = await apiGet<{ onlineStatus?: string }>('/therapists/me');
        setOnline(me.onlineStatus === 'online');
      } catch {
        // ignore — leave default online=true
      }
    })();
  }, []);

  async function toggleOnline() {
    if (toggling) return;
    const next = !online;
    setOnline(next);
    setToggling(true);
    try {
      await apiPut('/therapists/me', { onlineStatus: next ? 'online' : 'offline' });
    } catch {
      setOnline(!next); // rollback
    } finally {
      setToggling(false);
    }
  }

  if (!data) return <div className="mobile-container bg-gradient-soft"><LoadingFull /></div>;

  const available = parseInt(data.earnings?.available_cents ?? '0', 10);
  const pending = parseInt(data.earnings?.pending_cents ?? '0', 10);

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Top hero: avatar + 通知 / 钱包 === */}
      <header className="flex items-center justify-between bg-white px-4 py-3 shadow-warm-xs">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 overflow-hidden rounded-full ring-2 ring-emerald-400/60">
            <div className="flex h-full w-full items-center justify-center bg-gradient-cta text-sm font-semibold text-white">
              <User className="h-5 w-5" />
            </div>
            {online && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/t/me/earnings" className="flex h-9 w-9 items-center justify-center rounded-full bg-warm-50 shadow-warm-xs">
            <Wallet className="h-4 w-4 text-primary" />
          </Link>
          <button className="relative flex h-9 w-9 items-center justify-center rounded-full bg-warm-50 shadow-warm-xs">
            <Bell className="h-4 w-4 text-ink-700" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-warm-50" />
          </button>
        </div>
      </header>

      {/* === 在线状态 card === */}
      <section className="px-4 pt-4">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-warm-sm">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${online ? 'bg-emerald-100' : 'bg-ink-100'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${online ? 'animate-pulse bg-emerald-500' : 'bg-ink-400'}`} />
          </div>
          <div className="flex-1">
            <div className="text-serif-cn text-sm font-semibold text-ink-900">
              {online ? '现在在线 · 可接派单' : '已下线'}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {online ? '关闭后客户看不到你 · 不影响已有订单' : '点击开启 · 让客户找到你'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleOnline()}
            disabled={toggling}
            className={`relative h-7 w-12 rounded-full transition disabled:opacity-60 ${online ? 'bg-gradient-cta' : 'bg-ink-200'}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                online ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      {/* === 收益大卡 · 渐变 === */}
      <section className="px-4 pt-3">
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-md">
          <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-white/80">AVAILABLE BALANCE</div>
          <div className="mt-1 flex items-end gap-1.5">
            <span className="num font-display text-4xl font-bold">${(available / 100).toFixed(2)}</span>
            <span className="pb-1 text-xs text-white/70">USD</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-white/85">
            <span>
              处理中 <span className="num font-display font-bold text-white">${(pending / 100).toFixed(2)}</span>
            </span>
            <Link
              href="/t/me/earnings"
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur active:scale-95"
            >
              申请提现 →
            </Link>
          </div>
        </div>
      </section>

      {/* === 4 stat tile === */}
      <section className="grid grid-cols-2 gap-2 px-4 pt-3">
        <StatTile icon={ShoppingBag} label="ORDERS" zh="近 30 天" value={data.orders.total_orders} color="text-primary" />
        <StatTile icon={Star} label="REVIEWS" zh="评价数" value={data.reviews.review_count} color="text-warning-500" />
        <StatTile icon={TrendingUp} label="TIPS" zh="收到小费" value={data.tips.tip_count} color="text-emerald-500" />
        <StatTile
          icon={Star}
          label="SCORE"
          zh="服务分"
          value={(data.reviews.avg_score_service / 10).toFixed(1)}
          color="text-warning-500"
        />
      </section>

      {/* === 派单中占位 (空状态) · 真实版接 dispatch_offers === */}
      {data.orders.paid_orders > 0 ? (
        <section className="px-4 pt-3">
          <Link
            href="/t/orders?status=paid"
            className="block rounded-2xl border border-warm-200 bg-gradient-to-br from-warm-50 to-rose-50 p-4 shadow-warm-sm transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="font-cormorant italic text-[10px] tracking-[0.3em] text-primary">INCOMING</span>
            </div>
            <div className="mt-1.5 text-serif-cn text-base font-semibold text-ink-900">
              {data.orders.paid_orders} 单已支付 · 待开始服务
            </div>
            <div className="mt-1 text-[11px] text-ink-600">点击查看派单详情</div>
          </Link>
        </section>
      ) : (
        <section className="px-4 pt-3">
          <div className="rounded-2xl border border-dashed border-ink-200 bg-white/60 p-4 text-center text-[12px] text-ink-500">
            暂无派单 · 保持在线让客户能找到你
          </div>
        </section>
      )}

      {/* === 快捷入口 grid === */}
      <section className="px-4 pt-4">
        <h3 className="mb-2 font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">QUICK ACTIONS · 快捷</h3>
        <div className="grid grid-cols-4 gap-2">
          <QuickItem icon={ImageIcon} label="档案" href="/t/me/profile" />
          <QuickItem icon={Calendar} label="排班" href="/t/me/profile" />
          <QuickItem icon={DollarSign} label="定价" href="/t/me/profile" />
          <QuickItem icon={Settings} label="设置" href="/t/me" />
        </div>
      </section>

      {/* === 收入构成 === */}
      <section className="px-4 pt-4">
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="mb-1.5 text-serif-cn text-sm font-semibold text-ink-900">收入构成</div>
          <div className="font-cormorant italic text-[10px] tracking-[0.25em] text-ink-500">REVENUE · 30 DAYS</div>
          <div className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-600">订单总额</span>
              <span className="num font-display font-semibold text-primary">
                {parseInt(data.orders.gross_points ?? '0', 10)} <span className="text-[10px] text-ink-500">pts</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-600">小费净收</span>
              <span className="num font-display font-semibold text-warning-500">
                {parseInt(data.tips.net_tip_points ?? '0', 10)} <span className="text-[10px] text-ink-500">pts</span>
              </span>
            </div>
          </div>
          {data.orders.disputed_orders > 0 && (
            <Link
              href="/t/orders?status=disputed"
              className="mt-3 flex items-center justify-between rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600"
            >
              <span>⚠ 有 {data.orders.disputed_orders} 单争议中</span>
              <span>处理 →</span>
            </Link>
          )}
        </div>
      </section>

      <TherapistBottomNav active="home" />
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  zh,
  value,
  color,
}: {
  icon: typeof HomeIcon;
  label: string;
  zh: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-xs">
      <div className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-warm-50 ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="num font-display text-2xl font-bold text-ink-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-700">{zh}</div>
      <div className="font-cormorant italic text-[9px] tracking-wider text-ink-500">{label}</div>
    </div>
  );
}

function QuickItem({ icon: Icon, label, href }: { icon: typeof HomeIcon; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-2xl bg-white py-3 shadow-warm-xs transition active:scale-95"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-warm-50 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-[11px] text-ink-700">{label}</span>
    </Link>
  );
}

