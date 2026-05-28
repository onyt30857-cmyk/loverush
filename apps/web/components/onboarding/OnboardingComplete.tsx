/**
 * 完成动画 + 首推 3 卡 · M03 F03-OB1 轮 6 收尾
 *
 * - 撒花 emoji + "齐活" 动画
 * - 3 个 RecommendCard 横滑
 * - 主 CTA:进推荐 / 次 CTA:进对话
 */
'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { GradientOrb } from '@/components/ui';
import { RecommendCard, type RecommendItem } from '@/components/RecommendCard';

interface Props {
  reply: string;
  recommendations: RecommendItem[];
  onContinue: () => void;
}

export function OnboardingComplete({ reply, recommendations, onContinue }: Props) {
  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([20, 60, 20]);
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <GradientOrb size={80} icon="✨" />
          <span className="absolute -right-2 -top-2 text-xl" aria-hidden>
            🎉
          </span>
        </div>
        <h2 className="mt-3 text-serif-cn text-[18px] font-bold text-ink-800">齐活</h2>
        <p className="mt-1 max-w-[280px] text-[12.5px] leading-6 text-ink-600">{reply}</p>
      </div>

      {recommendations.length > 0 && (
        <div>
          <div className="label-cormorant mb-1.5 px-1">{recommendations.length} 位首推</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
            {recommendations.map((r) => (
              <RecommendCard key={r.therapistId} item={r} variant="slim" />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white shadow-rose-md active:scale-[0.98]"
        >
          进我的助理首页
        </button>
        <Link
          href="/assistant/chat"
          className="block w-full rounded-full border border-warm-200 bg-white py-3 text-center text-[13px] font-medium text-ink-700 active:scale-[0.98]"
        >
          先跟小助理聊聊
        </Link>
      </div>
    </div>
  );
}
