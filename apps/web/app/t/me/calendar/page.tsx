'use client';

/**
 * 技师「经营日历」· 按天看忙闲 + 收益,激励多排班
 *
 * 月历热力:每天按完成单数上色(忙/闲),休息日灰显,有平台到账标 💰。
 * 点某天 → 当日明细:名义服务额(线下面付·不可验)分层 + 平台到账(打赏/陪聊/橱窗·已到账)+ 出勤/休息。
 * 休息日(未来)→ "去补排班"钩子。
 *
 * 诚实分层:名义服务收入(线下现金,平台估算)与平台到账(积分,可验)分开标注,绝不混成一个数字。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull } from '@/components/ui';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { apiGet } from '@/lib/api';

interface CalDay {
  date: string;
  serviceCount: number;
  serviceNominal: Array<{ code: string; sum: number }>;
  platformIncome: { tips: number; chat: number; shop: number; other: number; total: number };
  isRestDay: boolean;
}
interface CalResp { month: string; tz: string; days: CalDay[] }

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function ymNow(): string {
  // Bangkok 当月
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function fmtMoney(n: number): string {
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TherapistCalendarPage() {
  const todayYm = ymNow();
  const todayDate = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const [ym, setYm] = useState(todayYm);
  const [data, setData] = useState<CalResp | null>(null);
  const [sel, setSel] = useState<CalDay | null>(null);

  const load = useCallback(async (month: string) => {
    setData(null);
    try {
      const r = await apiGet<CalResp>(`/dashboard/therapist/me/calendar?month=${month}`);
      setData(r);
    } catch {
      setData({ month, tz: 'Asia/Bangkok', days: [] });
    }
  }, []);

  useEffect(() => { void load(ym); }, [ym, load]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalDay>();
    (data?.days ?? []).forEach((d) => m.set(d.date, d));
    return m;
  }, [data]);

  // 月度汇总(诚实分层)
  const summary = useMemo(() => {
    const days = data?.days ?? [];
    const platform = days.reduce((s, d) => s + d.platformIncome.total, 0);
    const serviceCount = days.reduce((s, d) => s + d.serviceCount, 0);
    const nominal = new Map<string, number>();
    days.forEach((d) => d.serviceNominal.forEach((n) => nominal.set(n.code, (nominal.get(n.code) ?? 0) + n.sum)));
    return { platform, serviceCount, nominal: Array.from(nominal.entries()) };
  }, [data]);

  // 热力分桶(按完成单数)
  const maxCount = useMemo(() => Math.max(1, ...(data?.days ?? []).map((d) => d.serviceCount)), [data]);
  const cellTone = (d: CalDay): string => {
    if (d.serviceCount === 0) return d.isRestDay ? 'bg-ink-50 text-ink-300' : 'bg-white text-ink-400';
    const r = d.serviceCount / maxCount;
    if (r > 0.66) return 'bg-primary text-white';
    if (r > 0.33) return 'bg-primary/60 text-white';
    return 'bg-primary/25 text-ink-700';
  };

  // 月首空格(周日开头)
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const firstWeekday = new Date(`${ym}-01T12:00:00+07:00`).getDay();
  const daysInMonth = new Date(Date.UTC(y, m, 1) - 86400000).getUTCDate();
  const cells: Array<CalDay | null> = [
    ...Array.from<unknown, CalDay | null>({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i): CalDay => {
      const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
      return byDate.get(date) ?? { date, serviceCount: 0, serviceNominal: [], platformIncome: { tips: 0, chat: 0, shop: 0, other: 0, total: 0 }, isRestDay: false };
    }),
  ];

  if (data === null) return <LoadingFull />;

  return (
    <TherapistShell>
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold text-ink-900">经营日历</h1>
        <p className="mt-0.5 text-[12px] text-ink-500">每天忙闲与收益一目了然 · 红越深当天单越多</p>

        {/* 月切换 */}
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setYm(shiftMonth(ym, -1))} className="rounded-full p-2 active:bg-warm-50">
            <ChevronLeft className="h-5 w-5 text-ink-500" />
          </button>
          <div className="text-[15px] font-semibold text-ink-800">{y} 年 {m} 月</div>
          <button
            type="button"
            onClick={() => ym < todayYm && setYm(shiftMonth(ym, 1))}
            disabled={ym >= todayYm}
            className="rounded-full p-2 active:bg-warm-50 disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5 text-ink-500" />
          </button>
        </div>

        {/* 月度汇总(诚实分层) */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
            <div className="text-[10px] text-emerald-700">平台到账(可提现) · 已到账</div>
            <div className="mt-0.5 text-[18px] font-bold text-emerald-700">{summary.platform.toLocaleString()} <span className="text-[11px] font-normal">积分</span></div>
          </div>
          <div className="rounded-xl border border-warm-100 bg-white p-3">
            <div className="text-[10px] text-ink-500">完成 {summary.serviceCount} 单 · 名义服务额</div>
            <div className="mt-0.5 text-[13px] font-semibold text-ink-700">
              {summary.nominal.length ? summary.nominal.map(([c, s]) => `${c} ${fmtMoney(s)}`).join(' · ') : '—'}
            </div>
            <div className="text-[9px] text-ink-400">线下面付 · 平台估算</div>
          </div>
        </div>

        {/* 月历网格 */}
        <div className="mt-4 grid grid-cols-7 gap-1 text-center">
          {WEEK.map((w) => (
            <div key={w} className="py-1 text-[10px] text-ink-400">{w}</div>
          ))}
          {cells.map((d, i) =>
            d === null ? (
              <div key={`e${i}`} />
            ) : (
              <button
                key={d.date}
                type="button"
                onClick={() => setSel(d)}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-[12px] ${cellTone(d)} ${d.date === todayDate ? 'ring-2 ring-primary' : ''}`}
              >
                <span>{parseInt(d.date.slice(-2), 10)}</span>
                {d.isRestDay && d.serviceCount === 0 && <span className="text-[8px] leading-none">休</span>}
                {d.platformIncome.total > 0 && <span className="absolute right-0.5 top-0.5 text-[8px]">💰</span>}
              </button>
            ),
          )}
        </div>
        <div className="mt-2 text-center text-[10px] text-ink-400">💰 当天有平台到账 · 「休」当天排班为休息</div>
      </div>

      {/* 当日明细 */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setSel(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink-900">{sel.date}</h3>
              <button type="button" onClick={() => setSel(null)}><X className="h-5 w-5 text-ink-400" /></button>
            </div>

            {/* 平台到账 · 已到账 */}
            <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
              <div className="text-[11px] font-medium text-emerald-700">平台到账 · 已到账(积分)</div>
              {sel.platformIncome.total > 0 ? (
                <div className="mt-1.5 space-y-0.5 text-[12px] text-ink-700">
                  {sel.platformIncome.tips > 0 && <div className="flex justify-between"><span>打赏</span><span>{sel.platformIncome.tips.toLocaleString()}</span></div>}
                  {sel.platformIncome.chat > 0 && <div className="flex justify-between"><span>陪聊</span><span>{sel.platformIncome.chat.toLocaleString()}</span></div>}
                  {sel.platformIncome.shop > 0 && <div className="flex justify-between"><span>橱窗</span><span>{sel.platformIncome.shop.toLocaleString()}</span></div>}
                  {sel.platformIncome.other > 0 && <div className="flex justify-between"><span>其他</span><span>{sel.platformIncome.other.toLocaleString()}</span></div>}
                  <div className="flex justify-between border-t border-emerald-100 pt-1 font-semibold text-emerald-700"><span>合计</span><span>{sel.platformIncome.total.toLocaleString()} 积分</span></div>
                </div>
              ) : (
                <div className="mt-1 text-[12px] text-ink-400">无</div>
              )}
            </div>

            {/* 名义服务 · 线下面付 */}
            <div className="mt-2 rounded-xl border border-warm-100 bg-white p-3">
              <div className="text-[11px] font-medium text-ink-600">服务订单 · 线下面付(名义·平台不可验)</div>
              {sel.serviceCount > 0 ? (
                <div className="mt-1 text-[12px] text-ink-700">
                  完成 {sel.serviceCount} 单 · {sel.serviceNominal.length ? sel.serviceNominal.map((n) => `${n.code} ${fmtMoney(n.sum)}`).join(' · ') : '积分单'}
                </div>
              ) : (
                <div className="mt-1 text-[12px] text-ink-400">无完成订单</div>
              )}
            </div>

            {/* 休息日激励 */}
            {sel.isRestDay && (
              <div className="mt-2 rounded-xl bg-warm-50 p-3 text-[12px] text-ink-600">
                这天排班为<strong>休息</strong>
                {sel.date >= todayDate && (
                  <Link href="/t/me/schedule" className="ml-2 font-medium text-primary underline">去补排班 →</Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </TherapistShell>
  );
}
