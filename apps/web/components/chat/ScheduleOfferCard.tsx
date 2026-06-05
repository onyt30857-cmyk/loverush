/**
 * 对话内选时段卡 · ScheduleOfferCard(内联·非 bottomsheet)
 *
 * 客户问档期/约时间 → 分身推这张卡,列出真实可约时段(排班引擎算的空档)。
 * 客户点某个时段 → onPick(therapistId,date,startAt,duration) → 父跳确认下单页、时间已预选
 * (/therapist/[id]/order?date=&startAt=&duration=)。
 *
 * 时间显示 fmtHHMM 用本地时区,与下单页 slot 口径一致(v1 UTC 存储)。零交易硬词。
 */
'use client';

import { Clock } from 'lucide-react';

export interface ScheduleOffer {
  therapistId: string;
  date: string; // YYYY-MM-DD (UTC v1)
  durationMinutes: number;
  slots: Array<{ startAt: string; endAt: string }>;
}

interface Props {
  offer: ScheduleOffer;
  onPick: (therapistId: string, date: string, startAt: string, durationMinutes: number) => void;
}

function fmtHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tmr = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (date === today) return '今天';
  if (date === tmr) return '明天';
  const parts = date.split('-');
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export function ScheduleOfferCard({ offer, onPick }: Props) {
  const slots = Array.isArray(offer.slots) ? offer.slots : [];
  if (slots.length === 0) return null;
  const day = dateLabel(offer.date);

  return (
    <div className="w-fit max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      {/* 标题 */}
      <div className="flex items-center gap-1.5 border-b border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-4 py-2.5">
        <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
        <div>
          <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">
            看看我{day}的空档，挑个你方便的~
          </div>
          <div className="mt-0.5 text-[10.5px] text-ink-400">点一下就帮你把这个点留住</div>
        </div>
      </div>

      {/* 时段网格 */}
      <div className="grid grid-cols-3 gap-2 p-3">
        {slots.map((s, i) => (
          <button
            key={`${s.startAt}-${i}`}
            type="button"
            onClick={() => onPick(offer.therapistId, offer.date, s.startAt, offer.durationMinutes)}
            className="rounded-xl border border-warm-100 bg-white px-2 py-2 text-center text-[13px] font-medium text-ink-800 transition hover:border-primary/40 hover:bg-primary/5 active:scale-95"
          >
            {fmtHHMM(s.startAt)}
          </button>
        ))}
      </div>
    </div>
  );
}
