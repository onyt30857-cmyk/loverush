/**
 * 跨次记忆 + 主动 CTA 合一卡 · M03 v3 区块 2
 *
 * 视觉:暖色卡 · headline 加粗 + sub 灰 + 2-3 个按钮
 *  - book_again      主按钮 · 跳技师预约页
 *  - try_another     次按钮 · 触发 onRefreshPicks 回到推荐区
 *  - just_chat       次按钮 · 触发 onChatPrefill (滚动 + focus + 预填)
 *  - view_therapist  次按钮 · 跳技师详情
 *  - send_message    次按钮 · 触发 onChatPrefill(预填特定文本)
 *
 * 设计意图:用真实跨次记忆把"虚线占位"杀掉(Booksy 隐藏规则:cta=null 时整块不渲染)。
 */
'use client';

import { useRouter } from 'next/navigation';
import type { MemoryCta, MemoryCtaAction } from './types';

interface Props {
  cta: MemoryCta | null | undefined;
  /** 用户点"换个人" → home 触发 refresh-picks */
  onRefreshPicks?: () => void;
  /** 用户点"先聊聊 / 给我发个消息" → 滚到输入框并预填 */
  onChatPrefill?: (text: string) => void;
}

export function GreetingMemoryCard({ cta, onRefreshPicks, onChatPrefill }: Props) {
  const router = useRouter();
  if (!cta) return null;

  function handle(act: MemoryCtaAction) {
    switch (act.key) {
      case 'book_again':
        if (act.ref_id) router.push(`/therapist/${act.ref_id}`);
        return;
      case 'view_therapist':
        if (act.ref_id) router.push(`/therapist/${act.ref_id}`);
        return;
      case 'try_another':
        onRefreshPicks?.();
        return;
      case 'just_chat':
        onChatPrefill?.(act.prefill ?? '');
        return;
      case 'send_message':
        onChatPrefill?.(act.prefill ?? '');
        return;
    }
  }

  return (
    <section className="px-4 pt-1 pb-3" aria-labelledby="memory-cta-heading">
      <div className="rounded-2xl border border-warm-100 bg-gradient-to-br from-warm-50 to-white px-4 py-3 shadow-warm-sm">
        <h2
          id="memory-cta-heading"
          className="text-serif-cn text-[14px] font-semibold leading-6 text-ink-800"
        >
          {cta.headline}
        </h2>
        <p className="mt-1 text-[12px] leading-5 text-ink-500">{cta.sub}</p>
        {cta.actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {cta.actions.map((act) => {
              const isPrimary = act.primary === true;
              return (
                <button
                  key={`${act.key}-${act.ref_id ?? act.label}`}
                  type="button"
                  onClick={() => handle(act)}
                  className={
                    isPrimary
                      ? 'rounded-full bg-gradient-cta px-3 py-1.5 text-[12px] font-medium text-white shadow-rose-md active:scale-95'
                      : 'rounded-full border border-warm-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 active:scale-95 active:bg-warm-50'
                  }
                >
                  {act.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
