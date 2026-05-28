/**
 * 今晚为你挑了 · M03 v3 区块 3
 *
 * 上方:reason_tag 灰小字("基于你常选的安静型")
 * 中部:3 张 TherapistMiniCard 横排 · 内部 overflow-x-auto + scroll-snap-x · 允许微滑
 * 下方:[换 3 个] (POST /assistant/home/refresh-picks) + [告诉我想要啥] (预填 InlineChatInput)
 *
 * 永不空:items 为空时显示编辑兜底卡(防虚线占位文案).
 */
'use client';

import { RefreshCw, Sparkles } from 'lucide-react';
import { TherapistMiniCard } from './TherapistMiniCard';
import type { TodayPicks } from './types';

interface Props {
  picks: TodayPicks | undefined;
  onRefreshPicks: () => void;
  onChatPrefill: (text: string) => void;
  refreshing?: boolean;
}

export function RecommendationStrip({ picks, onRefreshPicks, onChatPrefill, refreshing }: Props) {
  const items = picks?.items ?? [];
  const reasonTag = picks?.reason_tag ?? '编辑精选 · 城市口碑稳';

  return (
    <section className="px-4 pt-1 pb-3" aria-labelledby="picks-heading">
      <h2 id="picks-heading" className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-500">
        <span className="text-[14px]">🔥</span>
        <span className="truncate">今晚为你挑了 · {reasonTag}</span>
      </h2>

      {items.length > 0 ? (
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
          {items.map((it) => (
            <TherapistMiniCard key={it.therapist_id} data={it} onChat={onChatPrefill} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-warm-100 bg-white px-4 py-4 text-center text-[12px] text-ink-500 shadow-warm-xs">
          编辑正在挑人 · 稍等给你 3 个稳的
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onRefreshPicks}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-full border border-warm-200 bg-white px-3 py-1.5 text-[11.5px] text-ink-700 active:scale-95 active:bg-warm-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          换 3 个
        </button>
        <button
          type="button"
          onClick={() => onChatPrefill('我想找...')}
          className="inline-flex items-center gap-1 rounded-full border border-warm-200 bg-white px-3 py-1.5 text-[11.5px] text-ink-700 active:scale-95 active:bg-warm-50"
        >
          <Sparkles className="h-3 w-3 text-warm-500" />
          告诉我想要啥
        </button>
      </div>
    </section>
  );
}
