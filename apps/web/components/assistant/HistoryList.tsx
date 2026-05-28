/**
 * 历史对话列表 · M03 F03-Home1 区块 3
 *
 * 最近 3 条 · 点击恢复上下文。
 * 空态:不显本区块(避免冷启动空白感)。
 */
'use client';

import { HistoryItem } from './HistoryItem';
import type { HistoryItemData } from './types';

interface Props {
  items: HistoryItemData[];
}

export function HistoryList({ items }: Props) {
  if (items.length === 0) return null;
  const top3 = items.slice(0, 3);
  return (
    <section className="px-4 pb-4" aria-labelledby="history-heading">
      <h2 id="history-heading" className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">
        📋 继续上次对话
      </h2>
      <div className="space-y-2">
        {top3.map((i) => (
          <HistoryItem key={i.id} item={i} />
        ))}
      </div>
    </section>
  );
}
