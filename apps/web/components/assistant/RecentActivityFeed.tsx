/**
 * 你最近 · M03 v3 区块 4
 *
 * 跨次记忆显性化 · 行为+原话混排.
 *
 * 视觉:列表 · 每条 icon + 文本
 *   - booking  💬  跳订单详情 /order/${ref_id}
 *   - question 🔍  跳 chat 历史 /assistant/chat?session=${ref_id}
 *   - favorite ⭐  跳技师详情 /therapist/${ref_id}
 *   - view     👁  跳技师详情 /therapist/${ref_id}
 *
 * 限 5 条 · 空数组时该 section 不渲染.
 */
'use client';

import { useRouter } from 'next/navigation';
import type { RecentActivityItem } from './types';

interface Props {
  items: RecentActivityItem[] | undefined;
}

function iconFor(type: RecentActivityItem['type']): string {
  switch (type) {
    case 'booking':
      return '💬';
    case 'question':
      return '🔍';
    case 'favorite':
      return '⭐';
    case 'view':
      return '👁';
  }
}

export function RecentActivityFeed({ items }: Props) {
  const router = useRouter();
  if (!items || items.length === 0) return null;
  const list = items.slice(0, 5);

  function handleClick(item: RecentActivityItem) {
    if (!item.ref_id) return;
    switch (item.type) {
      case 'booking':
        router.push(`/order/${item.ref_id}`);
        return;
      case 'question':
        router.push(`/assistant/chat?session=${encodeURIComponent(item.ref_id)}`);
        return;
      case 'favorite':
      case 'view':
        router.push(`/therapist/${item.ref_id}`);
        return;
    }
  }

  return (
    <section className="px-4 pt-1 pb-3" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-1.5 text-[12px] text-ink-500">
        📔 你最近
      </h2>
      <ul className="divide-y divide-warm-100 overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-xs">
        {list.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => handleClick(item)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12.5px] leading-5 text-ink-700 active:bg-warm-50"
            >
              <span className="mt-0.5 shrink-0 text-[13px]" aria-hidden>
                {iconFor(item.type)}
              </span>
              <span className="line-clamp-2 flex-1">{item.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
