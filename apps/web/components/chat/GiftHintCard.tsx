/**
 * 对话内礼物卡 · GiftHintCard(内联·非 bottomsheet)
 *
 * 客户处情绪峰值(刚夸她/聊得开心)时,系统浮这张轻入口卡(分身不硬开口)。
 * 点「宠宠她」→ onOpen() → 父打开 GiftSheet 选礼物送。
 *
 * 文案铁律(调研落地):软性暗示>交易词、留自由感("送不送都不影响…")消解压力反提转化、
 *   CTA 用情感动词不用"支付/购买"。零交易硬词。
 */
'use client';

import { Heart } from 'lucide-react';

interface Props {
  therapistName?: string | null;
  onOpen: () => void;
}

export function GiftHintCard({ therapistName, onOpen }: Props) {
  const who = therapistName || '她';
  return (
    <div className="w-fit max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-warm-50">
          <Heart className="h-4.5 w-4.5 fill-primary text-primary" />
        </div>
        <div className="min-w-0">
          <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">
            {who}偷偷想要点甜的~
          </div>
          <div className="mt-0.5 text-[10.5px] text-ink-400">送不送都不影响{who}喜欢跟你聊~</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full border-t border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-4 py-2.5 text-center text-[12.5px] font-medium text-primary active:scale-[0.99]"
      >
        宠宠{who} 💕
      </button>
    </div>
  );
}
