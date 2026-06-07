'use client';

/**
 * 客户「我的足迹」· 回忆 + 一键再约(不是消费账单)
 *
 * 时光轴(左侧日期节点 + 竖线 + 右侧卡片):那天见过谁(头像点跳详情)+ 一键「再约」。
 * 金额克制:每条小字次要,绝不做累计总额(避免请鲸鱼算账→触发后悔)。
 * 隐私:进入前一道遮挡确认(找了谁是私密记录)。只把 COMPLETED/REVIEWED 当足迹。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { LoadingFull } from '@/components/ui';
import { Lock, CalendarHeart, ChevronRight } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { apptLocalDate } from '@/lib/appointment-time';

interface Order {
  id: string;
  status: string;
  therapistId: string;
  therapistName: string | null;
  therapistAvatarUrl: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  currencyCode: string | null;
  totalFiat: string | null;
  pricePoints: number;
  fiatEstimated?: boolean;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function visitDate(o: Order): Date {
  return apptLocalDate(o.scheduledAt ?? o.createdAt);
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function relLabel(d: Date): string | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return null;
}
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function amountLabel(o: Order): string {
  if (o.totalFiat != null) return `${o.fiatEstimated ? '≈' : ''}${o.currencyCode ?? ''} ${o.totalFiat}`.trim();
  if (o.pricePoints > 0) return `${o.pricePoints} 积分`;
  return '';
}

export default function FootprintPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await apiGet<Order[]>('/orders?role=customer&limit=200'));
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  const groups = useMemo(() => {
    const fp = (orders ?? []).filter((o) => o.status === 'COMPLETED' || o.status === 'REVIEWED');
    const byDay = new Map<string, { date: Date; items: Array<Order & { _d: Date }> }>();
    for (const o of fp) {
      const d = visitDate(o);
      const k = dayKey(d);
      const g = byDay.get(k) ?? { date: d, items: [] };
      g.items.push({ ...o, _d: d });
      byDay.set(k, g);
    }
    return Array.from(byDay.values())
      .map((g) => ({ ...g, items: g.items.sort((a, b) => b._d.getTime() - a._d.getTime()) }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [orders]);

  // 隐私门
  if (!unlocked) {
    return (
      <AppShell title="我的足迹" showBack>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-50 to-warm-100">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mt-5 text-[17px] font-semibold text-ink-900">这是你的私密足迹</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-500">
            记录你和她们的每一段时光。<br />仅你自己可见。
          </p>
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="mt-7 w-full max-w-xs rounded-full bg-gradient-cta py-3.5 text-[14px] font-semibold text-white shadow-rose-md active:scale-[0.99]"
          >
            进入查看
          </button>
        </div>
      </AppShell>
    );
  }

  if (orders === null) return <LoadingFull />;

  return (
    <AppShell title="我的足迹" showBack>
      {/* 暖色头图 */}
      <div className="bg-gradient-to-b from-primary-50/70 to-transparent px-5 pb-2 pt-5">
        <div className="font-cormorant text-[11px] italic tracking-[0.3em] text-primary/70">YOUR JOURNEY</div>
        <h1 className="mt-0.5 text-[20px] font-semibold text-ink-900">和她们的时光</h1>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
          <CalendarHeart className="h-12 w-12 text-warm-200" />
          <p className="mt-4 text-[13.5px] font-medium text-ink-600">还没有足迹</p>
          <p className="mt-1 text-[12px] text-ink-400">完成第一次见面后,这里会留下你们的时光</p>
          <Link href="/home" className="mt-6 rounded-full bg-gradient-cta px-6 py-2.5 text-[13px] font-semibold text-white">
            去发现
          </Link>
        </div>
      ) : (
        <div className="px-4 pb-6 pt-2">
          {groups.map((g) => {
            const rel = relLabel(g.date);
            return (
              <div key={dayKey(g.date)} className="relative pl-16">
                {/* 时间轴左栏:日期节点 + 竖线 */}
                <div className="absolute left-0 top-0 flex w-12 flex-col items-center">
                  <div className="flex h-12 w-12 flex-col items-center justify-center rounded-2xl bg-white shadow-warm-sm ring-1 ring-warm-100">
                    <span className="text-[17px] font-bold leading-none text-ink-900">{g.date.getDate()}</span>
                    <span className="mt-0.5 font-cormorant text-[8px] tracking-widest text-primary/70">{MONTH_EN[g.date.getMonth()]}</span>
                  </div>
                  <div className="mt-1 w-px flex-1 bg-warm-100" />
                </div>

                {/* 日期标签 */}
                <div className="mb-2 flex items-center gap-2 pt-1">
                  <span className="text-[13px] font-semibold text-ink-800">
                    {rel ?? `${g.date.getMonth() + 1}月${g.date.getDate()}日`} · 周{WEEK[g.date.getDay()]}
                  </span>
                  {g.items.length > 1 && (
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-medium text-primary">见了 {g.items.length} 位</span>
                  )}
                </div>

                {/* 卡片 */}
                <div className="space-y-2.5 pb-5">
                  {g.items.map((o) => (
                    <div key={o.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-warm-sm ring-1 ring-warm-100/60">
                      <Link href={`/therapist/${o.therapistId}`} className="shrink-0">
                        {o.therapistAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.therapistAvatarUrl} alt={o.therapistName ?? '技师'} className="h-14 w-14 rounded-2xl object-cover" />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-warm-100 text-[16px] font-semibold text-primary">
                            {o.therapistName?.[0] ?? '技'}
                          </div>
                        )}
                      </Link>
                      <Link href={`/therapist/${o.therapistId}`} className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-ink-900">{o.therapistName ?? '技师'}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[11px] text-ink-400">{hhmm(o._d)}</span>
                          {amountLabel(o) && <span className="text-[11px] text-ink-300">· {amountLabel(o)}</span>}
                        </div>
                      </Link>
                      <Link
                        href={`/therapist/${o.therapistId}/order`}
                        className="flex shrink-0 items-center gap-0.5 rounded-full bg-gradient-cta px-3.5 py-2 text-[12px] font-semibold text-white shadow-rose-sm active:scale-[0.97]"
                      >
                        再约她<ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
