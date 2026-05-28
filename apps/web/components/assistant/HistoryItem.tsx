/**
 * 单条历史对话 · M03 F03-Home1 区块 3 子项
 *
 * 点击 → /assistant/chat?session=xxx · 恢复上下文(由 chat 页处理 session)
 */
'use client';

import Link from 'next/link';
import { MessageSquare, ChevronRight } from 'lucide-react';
import type { HistoryItemData } from './types';

interface Props {
  item: HistoryItemData;
}

/** 友好相对时间 · "刚刚 / N 分钟前 / N 小时前 / N 天前" */
function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  return `${mo} 月前`;
}

export function HistoryItem({ item }: Props) {
  return (
    <Link
      href={`/assistant/chat?session=${encodeURIComponent(item.id)}`}
      aria-label={`恢复对话:${item.preview}`}
      className="flex items-center gap-3 rounded-xl border border-warm-100 bg-white px-3 py-2.5 shadow-warm-xs transition active:scale-[0.99]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warm-50 text-warm-500">
        <MessageSquare className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[13px] font-medium text-ink-800">{item.preview}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-ink-400">
          <span>{relTime(item.updated_at)}</span>
          <span>·</span>
          <span>{item.turns_count} 轮</span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-300" />
    </Link>
  );
}
