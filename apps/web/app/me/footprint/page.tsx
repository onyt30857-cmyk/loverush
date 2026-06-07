'use client';

/**
 * 客户「我的足迹」· 回忆 + 一键再约(不是消费账单)
 *
 * 按天时间线:那天见过谁(头像并排,点跳技师详情)+ 一键「再约」。
 * 金额克制:每条小字次要,绝不做累计总额(避免请鲸鱼算账→触发后悔)。
 * 隐私:进入前一道遮挡确认(找了谁是私密记录)。
 * 只把 COMPLETED/REVIEWED 当足迹;取消/退款不计。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { LoadingFull } from '@/components/ui';
import { Eye, CalendarHeart } from 'lucide-react';
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

function visitDate(o: Order): Date {
  return apptLocalDate(o.scheduledAt ?? o.createdAt);
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
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
      const list = await apiGet<Order[]>('/orders?role=customer&limit=200');
      setOrders(list);
    } catch {
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  // 按天分组(只 COMPLETED/REVIEWED)
  const groups = useMemo(() => {
    const fp = (orders ?? []).filter((o) => o.status === 'COMPLETED' || o.status === 'REVIEWED');
    const byDay = new Map<string, { date: Date; items: Order[] }>();
    for (const o of fp) {
      const d = visitDate(o);
      const k = dayKey(d);
      const g = byDay.get(k) ?? { date: d, items: [] };
      g.items.push(o);
      byDay.set(k, g);
    }
    return Array.from(byDay.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [orders]);

  // 隐私门
  if (!unlocked) {
    return (
      <AppShell title="我的足迹" showBack>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warm-100">
            <Eye className="h-7 w-7 text-ink-400" />
          </div>
          <h2 className="mt-4 text-[16px] font-semibold text-ink-800">这是你的私密足迹</h2>
          <p className="mt-1 text-[12.5px] leading-6 text-ink-500">记录你见过谁、那段时光。仅你自己可见。</p>
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="mt-6 w-full max-w-xs rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white active:scale-[0.99]"
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
      <div className="px-4 py-4">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CalendarHeart className="h-10 w-10 text-warm-200" />
            <p className="mt-3 text-[13px] text-ink-400">还没有足迹 · 完成第一次见面后会留在这里</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={dayKey(g.date)}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink-800">{dayLabel(g.date)}</span>
                  {g.items.length > 1 && (
                    <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[10px] text-ink-500">这天见了 {g.items.length} 位</span>
                  )}
                </div>
                <div className="space-y-2">
                  {g.items.map((o) => (
                    <div key={o.id} className="flex items-center gap-3 rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-sm">
                      <Link href={`/therapist/${o.therapistId}`} className="shrink-0">
                        {o.therapistAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.therapistAvatarUrl} alt={o.therapistName ?? '技师'} className="h-12 w-12 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warm-100 text-[14px] text-ink-400">
                            {o.therapistName?.[0] ?? '技'}
                          </div>
                        )}
                      </Link>
                      <Link href={`/therapist/${o.therapistId}`} className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-ink-800">{o.therapistName ?? '技师'}</div>
                        {amountLabel(o) && <div className="mt-0.5 text-[11px] text-ink-400">{amountLabel(o)}</div>}
                      </Link>
                      <Link
                        href={`/therapist/${o.therapistId}/order`}
                        className="shrink-0 rounded-full bg-gradient-cta px-4 py-1.5 text-[12px] font-semibold text-white active:scale-[0.99]"
                      >
                        再约她
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
