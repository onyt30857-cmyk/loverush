'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Wallet,
  Star,
  Calendar,
  User,
  Users,
  Image as ImageIcon,
  DollarSign,
  Settings,
  ClipboardCheck,
  Sprout,
  ArrowRight,
} from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import { TherapistBottomNav } from '@/components/BottomNav';

interface Dashboard {
  orders: { total_orders: number; paid_orders: number; disputed_orders: number };
  tips: { tip_count: number };
  reviews: { review_count: number; avg_score_service: number };
  earnings: null | { available_cents: string; pending_cents: string };
  platform: {
    unique_customers: number;
    new_customers: number;
    repeat_customers: number;
    gmv_fiat: string;
    gmv_currency: string | null;
    gmv_order_count: number;
    pending_confirm_count: number;
    today_orders: number;
    today_gmv: string;
  };
}

const FIAT_SYMBOL: Record<string, string> = {
  THB: '฿', SGD: 'S$', USD: '$', CNY: '¥', VND: '₫', MYR: 'RM', HKD: 'HK$', TWD: 'NT$',
};
function fiat(amount: string | number, currency: string | null): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  const sym = currency ? (FIAT_SYMBOL[currency] ?? currency + ' ') : '';
  return `${sym}${Math.round(n).toLocaleString()}`;
}

export default function TherapistHomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [online, setOnline] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [completeness, setCompleteness] = useState<number | null>(null);
  const [name, setName] = useState<string>('');

  useEffect(() => {
    void (async () => {
      try {
        setData(await apiGet<Dashboard>('/dashboard/therapist/me'));
      } catch {
        setData(null);
      }
    })();
    void (async () => {
      try {
        const me = await apiGet<{ onlineStatus?: string; profileCompleteness?: number; displayName?: string | null }>('/therapists/me');
        setOnline(me.onlineStatus === 'online');
        setCompleteness(me.profileCompleteness ?? null);
        setName(me.displayName ?? '');
      } catch {
        /* 默认 online=true */
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
      setOnline(!next);
    } finally {
      setToggling(false);
    }
  }

  const p = data?.platform;
  // 空态 = 平台还没带来过客户 + 无订单历史(新技师)
  const isEmpty = data != null && (p?.unique_customers ?? 0) === 0 && (data.orders.total_orders ?? 0) === 0;
  const repeatPct = p && p.unique_customers > 0 ? Math.round((p.repeat_customers / p.unique_customers) * 100) : 0;

  const available = data?.earnings ? parseInt(data.earnings.available_cents ?? '0', 10) : null;
  const pending = data?.earnings ? parseInt(data.earnings.pending_cents ?? '0', 10) : null;

  return (
    <div className="mobile-container bg-gradient-soft pb-2">
      {/* 顶部 */}
      <header className="flex items-center justify-between bg-white px-4 py-3 shadow-warm-xs">
        <div className="relative h-11 w-11 overflow-hidden rounded-full ring-2 ring-warm-200">
          <div className="flex h-full w-full items-center justify-center bg-gradient-cta text-sm font-semibold text-white">
            <User className="h-5 w-5" />
          </div>
          {online && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/t/me/wallet" className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-warm-xs ring-1 ring-warm-100">
            <Wallet className="h-4 w-4 text-primary" />
          </Link>
          <button className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-warm-xs ring-1 ring-warm-100">
            <Bell className="h-4 w-4 text-ink-700" />
            <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-white" />
          </button>
        </div>
      </header>

      {/* 问候 */}
      <div className="px-5 pb-3 pt-4">
        <div className="text-serif-cn text-[21px] font-bold text-ink-900">
          {isEmpty ? `欢迎加入${name ? '，' + name : ''}` : `下午好${name ? '，' + name : ''}`}
        </div>
        <div className="mt-0.5 text-[12.5px] text-ink-600">
          {isEmpty ? '完善资料 + 保持在线，平台开始为你带客户' : '保持在线，平台正在为你带来客户'}
        </div>
      </div>

      {/* 在线开关(在线=珊瑚渐变强调块) */}
      <section className="px-4">
        <div
          className={`flex items-center gap-3.5 rounded-[20px] p-4 transition ${
            online ? 'bg-gradient-cta text-white shadow-rose-lg' : 'bg-white text-ink-900 shadow-warm-sm'
          }`}
        >
          <div className={`flex h-11 w-11 items-center justify-center rounded-[14px] ${online ? 'bg-white/18' : 'bg-ink-100'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-[#7CF5C0] shadow-[0_0_0_4px_rgba(124,245,192,0.35)]' : 'bg-ink-400'}`} />
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-bold">{online ? '现在在线 · 可接派单' : '已下线'}</div>
            <div className={`mt-0.5 text-[11.5px] ${online ? 'text-white/85' : 'text-ink-500'}`}>
              {online ? '关闭后客户看不到你 · 不影响已有订单' : '点击开启 · 让客户找到你'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void toggleOnline()}
            disabled={toggling}
            className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition disabled:opacity-60 ${online ? 'bg-white/25' : 'bg-ink-200'}`}
          >
            <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${online ? 'translate-x-[25px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
      </section>

      {isEmpty ? (
        /* ===== 空态:正向引导,不显刺眼的 0 ===== */
        <>
          <section className="px-4 pt-3.5">
            <div className="relative overflow-hidden rounded-[22px] border border-warm-100 bg-gradient-to-br from-white to-rose-50/60 p-5 text-center">
              <div className="text-[30px]">🌱</div>
              <div className="mt-2 text-serif-cn text-[18px] font-bold text-ink-900">平台正在为你寻找客户</div>
              <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink-600">
                完善资料并保持在线，<br />就能接到你的第一位客户
              </div>
              <Link
                href="/t/me/profile"
                className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-gradient-cta px-6 py-2.5 text-[13.5px] font-semibold text-white shadow-rose-md active:scale-95"
              >
                完善资料，开始接单 <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          {completeness != null && completeness < 100 && (
            <section className="px-4 pt-3">
              <Link href="/t/me/profile" className="block rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs transition active:scale-[0.99]">
                <div className="flex items-center justify-between text-[12.5px] text-ink-800">
                  <span>资料完整度</span>
                  <span className="num font-display font-bold text-primary">{completeness}%</span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-warm-50">
                  <div className="h-full rounded-full bg-gradient-cta" style={{ width: `${completeness}%` }} />
                </div>
                <div className="mt-2 text-[11px] text-ink-500">完善头像 / 定价 / 真人核验 / 排班，提升曝光 →</div>
              </Link>
            </section>
          )}

          <PerfRow reviews={null} tips={null} score={null} locked />
        </>
      ) : (
        /* ===== 有数据:平台价值视角 ===== */
        <>
          {/* 今日概览条 */}
          <section className="px-4 pt-3.5">
            <div className="grid grid-cols-3 overflow-hidden rounded-[18px] border border-warm-100 bg-white">
              <TodayCell value={p ? String(p.today_orders) : '—'} label="今日订单" />
              <TodayCell value={p ? fiat(p.today_gmv, p.gmv_currency) : '—'} label="今日成交" border />
              <TodayCell value={p ? String(p.pending_confirm_count) : '—'} label="待确认" warn={!!p && p.pending_confirm_count > 0} />
            </div>
          </section>

          {/* 待办防漏单 */}
          {p && p.pending_confirm_count > 0 && (
            <section className="px-4 pt-3">
              <Link
                href="/t/orders"
                className="flex items-center gap-3 rounded-2xl border border-[#FFD9C9] bg-gradient-to-br from-[#FFF3EC] to-[#FFE9E2] p-3.5 transition active:scale-[0.99]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-white">
                  <ClipboardCheck className="h-4 w-4 text-[#E2683C]" />
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-semibold text-[#B5502E]">你有 {p.pending_confirm_count} 单待确认</span>
                  <span className="block text-[11px] text-[#C98B6E]">及时接单不流失客户 · 超时会自动取消</span>
                </span>
                <span className="rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-white">去处理 →</span>
              </Link>
            </section>
          )}

          {/* 平台价值卡(C位) */}
          <section className="px-4 pt-3.5">
            <div className="relative overflow-hidden rounded-[22px] border border-warm-100 bg-white p-[18px]">
              <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(255,138,122,0.10),transparent_70%)]" />
              <div className="relative font-cormorant italic text-[10px] tracking-[0.22em] text-ink-400">本月平台成果 · 近 30 天</div>
              <div className="relative mt-2.5 flex items-end gap-2">
                <span className="num font-display text-[50px] font-bold leading-none text-ink-900">{p ? p.unique_customers : '—'}</span>
                <span className="pb-2 text-[13px] text-ink-600">位客户</span>
              </div>
              <div className="relative mt-1.5 text-[12.5px] text-ink-600">
                平台把 <b className="font-semibold text-ink-900">{p ? p.unique_customers : '—'} 位客户</b> 带到你面前 · 款项客户线下直接付你
              </div>
              <div className="relative mt-4 flex items-center gap-4 border-t border-warm-50 pt-3.5">
                <div>
                  <div className="num font-display text-[21px] font-bold text-ink-900">{p ? fiat(p.gmv_fiat, p.gmv_currency) : '—'}</div>
                  <div className="text-[10.5px] text-ink-400">撮合成交额</div>
                </div>
                <div className="ml-auto flex items-center gap-2.5">
                  <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="#F4F0EC" strokeWidth="5" />
                    <circle cx="22" cy="22" r="18" fill="none" stroke="#FF5577" strokeWidth="5" strokeLinecap="round" strokeDasharray="113" strokeDashoffset={113 - (113 * repeatPct) / 100} />
                  </svg>
                  <div className="text-[10.5px] leading-tight text-ink-400">
                    <b className="block num font-display text-[17px] text-ink-900">{repeatPct}%</b>回头客
                  </div>
                </div>
              </div>
            </div>
          </section>

          <PerfRow
            reviews={data?.reviews.review_count ?? null}
            tips={data?.tips.tip_count ?? null}
            score={data?.reviews.avg_score_service == null ? null : (data.reviews.avg_score_service / 10).toFixed(1)}
          />
        </>
      )}

      {/* 余额降级小卡 */}
      <section className="px-4 pt-3">
        <div className="flex items-center gap-3 rounded-2xl border border-warm-100 bg-white p-3.5 shadow-warm-xs">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-warm-50 text-[14px]">💳</span>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-ink-900">
              线上可提现 <span className="num font-display">{available == null ? '—' : `$${(available / 100).toFixed(2)}`}</span>
              {pending != null && pending > 0 && <span className="ml-1.5 text-[11px] font-normal text-ink-400">处理中 ${(pending / 100).toFixed(2)}</span>}
            </div>
            <div className="mt-0.5 text-[10.5px] text-ink-400">小费 / 陪聊 / 橱窗分成 · 订单款客户线下付你，不走平台</div>
          </div>
          <Link href="/t/me/earnings" className="rounded-full border border-[#FFD9D0] px-3.5 py-1.5 text-[12px] font-semibold text-primary active:scale-95">
            提现
          </Link>
        </div>
      </section>

      {/* 快捷 */}
      <section className="px-4 pt-4">
        <div className="grid grid-cols-4 gap-2.5">
          <QuickItem icon={ImageIcon} label="档案" href="/t/me/profile" />
          <QuickItem icon={Calendar} label="排班" href="/t/schedule" />
          <QuickItem icon={DollarSign} label="定价" href="/t/me/profile" />
          <QuickItem icon={Settings} label="设置" href="/t/me" />
        </div>
      </section>

      <TherapistBottomNav active="home" />
    </div>
  );
}

function TodayCell({ value, label, border, warn }: { value: string; label: string; border?: boolean; warn?: boolean }) {
  return (
    <div className={`py-3.5 text-center ${border ? 'border-x border-warm-50' : ''}`}>
      <div className={`num font-display text-[23px] font-bold ${warn ? 'text-primary' : 'text-ink-900'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-600">{label}</div>
    </div>
  );
}

function PerfRow({
  reviews,
  tips,
  score,
  locked,
}: {
  reviews: number | null;
  tips: number | null;
  score: string | null;
  locked?: boolean;
}) {
  return (
    <>
      <div className="flex items-baseline gap-2 px-5 pb-2 pt-5">
        <span className="font-cormorant italic text-[10px] tracking-[0.22em] text-ink-400">Performance</span>
        <span className="text-serif-cn text-[15px] font-bold text-ink-900">接单表现</span>
        {locked && <span className="ml-auto text-[11px] text-ink-400">完成首单后解锁</span>}
      </div>
      <section className={`grid grid-cols-3 gap-2.5 px-4 ${locked ? 'opacity-55' : ''}`}>
        <PerfCell value={locked ? '—' : reviews ?? '—'} label="评价" />
        <PerfCell value={locked ? '—' : tips ?? '—'} label="收到小费" />
        <PerfCell value={locked ? '—' : score ?? '—'} label="服务分" star={!locked && score != null} />
      </section>
    </>
  );
}

function PerfCell({ value, label, star }: { value: number | string; label: string; star?: boolean }) {
  return (
    <div className="rounded-2xl border border-warm-100 bg-white py-3.5 text-center shadow-warm-xs">
      <div className="num font-display text-[22px] font-bold text-ink-900">
        {value}
        {star && <Star className="mb-0.5 ml-0.5 inline h-3.5 w-3.5 fill-warning-500 text-warning-500" />}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-600">{label}</div>
    </div>
  );
}

function QuickItem({ icon: Icon, label, href }: { icon: typeof Users; label: string; href: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 rounded-2xl border border-warm-100 bg-white py-3.5 shadow-warm-xs transition active:scale-95">
      <Icon className="h-[19px] w-[19px] text-primary" />
      <span className="text-[11px] text-ink-600">{label}</span>
    </Link>
  );
}
