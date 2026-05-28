/**
 * 跨次记忆回挂气泡 · M03 F03-D6
 *
 * 在对话流中助理消息可附带引用上次内容,例:
 *   "上次你给 Lily 4.5 分 · 提到精油偏甜"
 *
 * 视觉:小卡片样式 · 灰底 + 时间戳 + 关键技师名高亮
 */
'use client';

import { Clock } from 'lucide-react';

export interface MemoryRecall {
  /** 上次的技师名 */
  therapistName?: string;
  /** 多久前 · 文本"3 天前 / 上周 / 上次"等 */
  whenLabel: string;
  /** 记忆内容(已经预格式化, ≤ 80 字) */
  content: string;
}

export function MemoryRecallChip({ recall }: { recall: MemoryRecall }) {
  return (
    <div className="ml-9 mt-1.5 max-w-[78%] rounded-xl border border-warm-100 bg-warm-50/60 px-2.5 py-1.5 text-[11px] leading-5 text-ink-600 shadow-warm-xs">
      <div className="mb-0.5 flex items-center gap-1 text-warm-600">
        <Clock className="h-2.5 w-2.5" />
        <span className="label-cormorant text-[8.5px]">MEMORY · {recall.whenLabel}</span>
      </div>
      <div>
        {recall.therapistName && (
          <span className="font-semibold text-ink-800">{recall.therapistName}</span>
        )}
        {recall.therapistName && ' · '}
        {recall.content}
      </div>
    </div>
  );
}
