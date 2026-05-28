/**
 * Today 卡片区 · M03 F03-Home1 区块 2
 *
 * 横滑列表 · 主动 push(L5 diff / 偏好稳定有档 / 新人推荐)
 * 空态:友好提示首单后会更聪明
 */
'use client';

import { TodayCard } from './TodayCard';
import type { TodayCard as TodayCardData } from './types';

interface Props {
  cards: TodayCardData[];
}

export function TodayCardsSection({ cards }: Props) {
  return (
    <section className="px-4 pt-2 pb-4" aria-labelledby="today-heading">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="today-heading" className="text-serif-cn text-[14px] font-semibold text-ink-800">
          🌅 今日为你
        </h2>
        {cards.length > 0 && (
          <span className="label-cormorant text-[10px] text-ink-400">{cards.length} 条</span>
        )}
      </div>
      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-warm-200 bg-white/60 px-4 py-5 text-center">
          <p className="text-[12px] leading-5 text-ink-500">
            刚见面 · 多聊几句我会变聪明
            <br />
            <span className="text-ink-400">下次进来给你推稳的</span>
          </p>
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {cards.map((c) => (
            <TodayCard key={c.id} card={c} />
          ))}
        </div>
      )}
    </section>
  );
}
