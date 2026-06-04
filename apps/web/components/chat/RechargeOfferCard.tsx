/**
 * 对话内充值卡 · RechargeOfferCard（内联·纯前端就地反馈）
 *
 * 扣费场景余额不足(E2010)那一刻,就地插这张卡,而不是把人跳走。
 * 点「去补充」→ onRecharge()(父跳 /me/recharge?from=companion)。
 * 软文案、零催促(只在余额不足时出现,不主动劝充值)。
 */
'use client';

import { Sparkles } from 'lucide-react';

interface Props {
  /** 可选:还差多少(显「就差一点点」更具体);不传则只显软文案 */
  shortfallLabel?: string | null;
  onRecharge: () => void;
}

export function RechargeOfferCard({ shortfallLabel, onRecharge }: Props) {
  return (
    <div className="w-fit max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-warm-50">
          <Sparkles className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">
            差一点点，补上就能继续~
          </div>
          <div className="mt-0.5 text-[10.5px] text-ink-400">
            {shortfallLabel ? shortfallLabel : '心动值不太够了，补一点点就好'}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onRecharge}
        className="block w-full border-t border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-4 py-2.5 text-center text-[12.5px] font-medium text-primary active:scale-[0.99]"
      >
        去补充 →
      </button>
    </div>
  );
}
