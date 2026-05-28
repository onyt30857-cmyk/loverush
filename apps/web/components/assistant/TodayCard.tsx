/**
 * Today 单卡 · M03 F03-Home1 区块 2 子项
 *
 * 三态视觉:
 *  - recall      昨晚浏览 / 跨次回挂 → 温暖玫粉左侧条
 *  - available   偏好稳定 + 当前可用 → 暖橙左侧条
 *  - new_match   新人推荐 → 深玫红 + ✨ 标
 */
'use client';

import Link from 'next/link';
import { ChevronRight, Eye, Calendar, Sparkles } from 'lucide-react';
import type { TodayCard as TodayCardData } from './types';

const VARIANT = {
  recall: {
    bar: 'bg-warm-400',
    icon: Eye,
    badge: '回挂',
    badgeBg: 'bg-warm-100 text-warm-700',
  },
  available: {
    bar: 'bg-gradient-cta',
    icon: Calendar,
    badge: '有档',
    badgeBg: 'bg-primary/10 text-primary',
  },
  new_match: {
    bar: 'bg-primary',
    icon: Sparkles,
    badge: '新挑',
    badgeBg: 'bg-success-500/10 text-success-500',
  },
} as const;

interface Props {
  card: TodayCardData;
}

export function TodayCard({ card }: Props) {
  const v = VARIANT[card.type];
  const Icon = v.icon;
  return (
    <Link
      href={card.action_href}
      aria-label={`${card.title} · ${card.subtitle}`}
      className="group relative block w-[260px] flex-shrink-0 overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-sm transition active:scale-[0.98]"
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${v.bar}`} aria-hidden />
      <div className="flex h-full flex-col gap-2 p-3 pl-4">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium ${v.badgeBg}`}>
            <Icon className="h-3 w-3" />
            {v.badge}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-ink-300 transition group-active:translate-x-0.5" />
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-1 text-serif-cn text-[14px] font-semibold text-ink-800">{card.title}</h3>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-[18px] text-ink-500">{card.subtitle}</p>
        </div>
      </div>
    </Link>
  );
}
