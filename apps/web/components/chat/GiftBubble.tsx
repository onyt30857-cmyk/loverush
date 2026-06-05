'use client';

/**
 * 礼物消息气泡（M18 · 对话里"送了什么"的持久记录，双方可见）
 *
 * 后端 reactToGift 发一条 type='gift' 消息(content=JSON{emoji,name,points})·
 * 客户身份(右侧)、技师也能看到(左侧)。比纯文本"送出X"更精致，对齐 Soul/直播的礼物消息。
 */
import { Gift } from 'lucide-react';

export interface GiftBubbleProps {
  emoji: string;
  name: string;
  points: number;
}

export function GiftBubble({ emoji, name, points }: GiftBubbleProps) {
  return (
    <div className="relative max-w-[78%] overflow-hidden rounded-2xl bg-gradient-to-br from-primary-100 via-warm-50 to-primary-50 px-3.5 py-3 shadow-warm-sm">
      {/* 角标礼盒 */}
      <Gift className="absolute -right-1.5 -top-1.5 h-12 w-12 rotate-12 text-primary-200/50" strokeWidth={1.5} />
      <div className="relative flex items-center gap-3">
        <span className="text-[40px] leading-none drop-shadow-sm">{emoji}</span>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-primary-500">送出心意 💝</div>
          <div className="truncate font-serif-cn text-[15px] font-bold text-ink-900">{name}</div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            <span className="font-semibold text-primary-600">{points.toLocaleString()}</span> 心动值
          </div>
        </div>
      </div>
    </div>
  );
}
