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

import Link from 'next/link';
import { RefreshCw, Sparkles, Compass } from 'lucide-react';
import { TherapistMiniCard } from './TherapistMiniCard';
import type { TodayPicks } from './types';

interface Props {
  picks: TodayPicks | undefined;
  onRefreshPicks: () => void;
  onChatPrefill: (text: string) => void;
  refreshing?: boolean;
}

/**
 * 3 种场景:
 *   ok       — items.length > 0 · 显示真实卡片
 *   no_match — 数据库真没 verified 技师 · 友好态 + 跳"看全部技师"
 *   preparing — 临时不可用(后端挂)· 友好态 + 重试按钮
 */
export function RecommendationStrip({ picks, onRefreshPicks, onChatPrefill, refreshing }: Props) {
  const items = picks?.items ?? [];
  const status = picks?.status ?? (items.length > 0 ? 'ok' : 'preparing');
  const reasonTag = picks?.reason_tag ?? '编辑精选 · 城市口碑稳';

  // 标题文案按场景区分
  const title =
    status === 'no_match'
      ? '今晚还没刚好对味的'
      : status === 'preparing'
        ? '正在为你挑'
        : `今晚为你挑了 · ${reasonTag}`;

  return (
    <section className="px-4 pt-1 pb-3" aria-labelledby="picks-heading">
      <h2 id="picks-heading" className="mb-1 flex items-center gap-1.5 text-[12px] text-ink-500">
        <span className="text-[14px]">🔥</span>
        <span className="truncate">{title}</span>
      </h2>

      {/* 场景 A · 有数据 · 真实卡片横滑 */}
      {items.length > 0 && (
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
          {items.map((it) => (
            <TherapistMiniCard key={it.therapist_id} data={it} onChat={onChatPrefill} />
          ))}
        </div>
      )}

      {/* 场景 B · no_match · 数据库真没 verified 技师 · 看全部 */}
      {items.length === 0 && status === 'no_match' && (
        <div className="rounded-2xl border border-warm-100 bg-white px-4 py-5 text-center shadow-warm-xs">
          <div className="mb-1 text-[13px] font-medium text-ink-700">今晚还没刚好对味的</div>
          <div className="mb-3 text-[11.5px] text-ink-500">
            可能你这边没合适的 · 直接到发现页挑吧
          </div>
          <Link
            href="/home"
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-cta px-4 py-1.5 text-[12px] font-medium text-white shadow-rose-md active:scale-95"
          >
            <Compass className="h-3.5 w-3.5" />
            看全部技师
          </Link>
        </div>
      )}

      {/* 场景 C · preparing · 临时不可用 · 重试 */}
      {items.length === 0 && status === 'preparing' && (
        <div className="rounded-2xl border border-warm-100 bg-white px-4 py-5 text-center shadow-warm-xs">
          <div className="mb-1 text-[13px] font-medium text-ink-700">编辑正在挑人</div>
          <div className="mb-3 text-[11.5px] text-ink-500">稍等给你 3 个稳的</div>
          <button
            type="button"
            onClick={onRefreshPicks}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full bg-warm-100 px-4 py-1.5 text-[12px] font-medium text-ink-700 active:scale-95 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            再挑一次
          </button>
        </div>
      )}

      {/* 底部操作按钮 · 有数据时显示 */}
      {items.length > 0 && (
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
      )}
    </section>
  );
}
