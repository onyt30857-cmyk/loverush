'use client';

/**
 * Customer · 心动金历史 · 0027
 *
 * 列出当前用户所有 deposit · 5 态 filter · 点击跳订单详情
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Heart } from 'lucide-react';
import { apiGet, ApiClientError } from '@/lib/api';
import { LoadingFull } from '@/components/ui';

interface DepositRow {
  depositId: string;
  orderId: string;
  orderNo: string;
  status: string;
  depositPoints: number;
  currencyCode: string | null;
  totalFiat: string | null;
  orderStatus: string | null;
  createdAt: string;
  releasedAt: string | null;
  resolution: string | null;
}

const STATUS_LABEL: Record<string, { label: string; tone: string; desc: string }> = {
  HOLDING: { label: '冻结中', tone: 'bg-blue-50 text-blue-700 border-blue-200', desc: '服务完成后自动退还' },
  RELEASED: { label: '已退还', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', desc: '已回到积分余额' },
  FORFEITED_TO_THERAPIST: {
    label: '扣留 · 技师',
    tone: 'bg-orange-50 text-orange-700 border-orange-200',
    desc: '本次未到场 · 50% 已分给技师',
  },
  FORFEITED_TO_PLATFORM: {
    label: '扣留 · 平台',
    tone: 'bg-orange-50 text-orange-700 border-orange-200',
    desc: '本次未到场 · 50% 已留平台',
  },
  REFUNDED: { label: '全退', tone: 'bg-gray-50 text-gray-700 border-gray-200', desc: '技师未到场已全退' },
};

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'HOLDING', label: '冻结中' },
  { key: 'RELEASED', label: '已退还' },
  { key: 'FORFEITED', label: '扣留' },
] as const;

export default function DepositsPage() {
  const [list, setList] = useState<DepositRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<typeof FILTERS[number]['key']>('all');

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<DepositRow[]>('/me/deposits?limit=100');
        setList(data);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.payload.message : String(err));
        setList([]);
      }
    })();
  }, []);

  if (!list) return <LoadingFull />;

  const filtered =
    filter === 'all'
      ? list
      : filter === 'FORFEITED'
        ? list.filter((d) => d.status.startsWith('FORFEITED'))
        : list.filter((d) => d.status === filter);

  // 汇总
  const heldTotal = list
    .filter((d) => d.status === 'HOLDING')
    .reduce((sum, d) => sum + d.depositPoints, 0);

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Top nav === */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <Link href="/me" className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">心动金</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">HEART DEPOSIT</div>
        </div>
        <div className="h-9 w-9" />
      </header>

      {/* 汇总卡 */}
      <section className="px-4 pt-3">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-white shadow-warm-md">
          <div className="flex items-center gap-2 text-[11px] text-white/85">
            <Heart className="h-3.5 w-3.5 fill-white text-white" />
            当前冻结
          </div>
          <div className="mt-1.5 text-display text-3xl font-bold">
            {heldTotal.toLocaleString()} <span className="text-base font-normal opacity-80">积分</span>
          </div>
          <div className="mt-1 text-[11px] text-white/85">
            服务完成自动退回 · 客户/技师鸽子按规则分账
          </div>
        </div>
      </section>

      {/* Filter chips */}
      <div className="no-scrollbar mt-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition active:scale-95 ${
                on ? 'border-primary bg-primary text-white' : 'border-warm-200 bg-white text-ink-700'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {/* 列表 */}
      <section className="px-4 pt-2 pb-8">
        {filtered.length === 0 ? (
          <div className="mt-12 text-center text-[12px] text-ink-500">
            还没有心动金记录
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((d) => {
              const info = STATUS_LABEL[d.status] ?? { label: d.status, tone: 'bg-gray-50 text-gray-700 border-gray-200', desc: '' };
              return (
                <li key={d.depositId}>
                  <Link
                    href={`/order/${d.orderId}`}
                    className={`block rounded-2xl border p-3.5 shadow-warm-xs transition active:scale-[0.99] ${info.tone}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-cormorant italic text-[10px] tracking-wider opacity-70">
                        {d.orderNo}
                      </span>
                      <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-medium">
                        {info.label}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-end justify-between">
                      <div>
                        <div className="text-[13px] font-semibold">
                          {d.depositPoints.toLocaleString()} 积分
                        </div>
                        <div className="mt-0.5 text-[10px] opacity-80">{info.desc}</div>
                      </div>
                      {d.currencyCode && d.totalFiat && (
                        <div className="text-right text-[10px] opacity-80">
                          <div>订单 {d.currencyCode} {d.totalFiat}</div>
                          <div className="mt-0.5">{new Date(d.createdAt).toLocaleDateString('zh-CN')}</div>
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
