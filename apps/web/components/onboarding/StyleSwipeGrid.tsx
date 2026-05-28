/**
 * 看图说话核心组件 · M03 F03-OB1 轮 3 ⭐
 *
 * 2×3 网格展示 6 张风格图卡:
 *  - 点击 → 选中(高亮 + 玫红描边)
 *  - 长按(450ms) → "划走"(动画消失)
 *  - 已选 / 已划走 计数 + 进度提示
 *  - "下一步"按钮:至少有过 3 次操作(选 + 划走 任意组合)才启用
 *  - 提交 payload = { kept: string[], swiped: string[] }
 *
 * 视觉:卡圆角 + 阴影 + 渐变占位(后端没真图时降级)
 * 触觉:每次操作 navigator.vibrate(15)
 */
'use client';

import { useMemo, useRef, useState } from 'react';
import { Heart, X, Check } from 'lucide-react';
import type { OnboardingSwipeCard } from './types';

interface Props {
  cards: OnboardingSwipeCard[];
  onSubmit: (kept: string[], swiped: string[]) => void;
  disabled?: boolean;
}

function vibrate() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(15);
    }
  } catch {
    // ignore
  }
}

/** 兜底渐变 · 后端给不出真 URL 时按 tag 文字 hash 选一个柔和暖渐变 */
const FALLBACK_GRADIENTS = [
  'bg-gradient-to-br from-warm-200 via-warm-100 to-warm-50',
  'bg-gradient-to-br from-primary/30 via-warm-200 to-warm-50',
  'bg-gradient-to-br from-warm-300 via-warm-200 to-warm-100',
  'bg-gradient-to-br from-warm-100 via-primary/20 to-warm-300',
  'bg-gradient-to-br from-warm-200 via-warm-300 to-warm-100',
  'bg-gradient-to-br from-warm-50 via-warm-100 to-primary/20',
];

const TAG_EMOJI: Record<string, string> = {
  温柔: '🌸',
  甜美: '🍑',
  御姐: '🌹',
  邻家: '☕',
  健身: '💪',
  成熟: '🍷',
  清新: '🍃',
  古典: '🎐',
  时尚: '✨',
  阳光: '☀️',
  文艺: '📖',
  冷艳: '❄️',
};

function emojiFor(tags: string[]): string {
  for (const t of tags) {
    if (TAG_EMOJI[t]) return TAG_EMOJI[t];
  }
  return '🌷';
}

export function StyleSwipeGrid({ cards, onSubmit, disabled }: Props) {
  const [kept, setKept] = useState<string[]>([]);
  const [swiped, setSwiped] = useState<string[]>([]);
  const [pressing, setPressing] = useState<string | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const remaining = useMemo(
    () => cards.filter((c) => !kept.includes(c.id) && !swiped.includes(c.id)),
    [cards, kept, swiped],
  );
  const totalActed = kept.length + swiped.length;
  const canSubmit = totalActed >= 3 && !disabled;

  function startPress(id: string) {
    if (longPress.current) clearTimeout(longPress.current);
    setPressing(id);
    longPress.current = setTimeout(() => {
      doSwipe(id);
    }, 450);
  }
  function endPress() {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    setPressing(null);
  }

  function doKeep(id: string) {
    if (disabled) return;
    vibrate();
    setKept((cur) => (cur.includes(id) ? cur : [...cur, id]));
  }
  function doSwipe(id: string) {
    if (disabled) return;
    vibrate();
    setSwiped((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setKept((cur) => cur.filter((x) => x !== id));
    setPressing(null);
  }

  return (
    <div className="space-y-3">
      {/* 操作提示 */}
      <div className="flex items-center justify-between text-[11px] text-ink-500">
        <span>👆 顺眼点 · 长按划走</span>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-0.5 text-primary">
            <Heart className="h-3 w-3 fill-current" /> {kept.length}
          </span>
          <span className="inline-flex items-center gap-0.5 text-ink-400">
            <X className="h-3 w-3" /> {swiped.length}
          </span>
        </span>
      </div>

      {/* 2×3 网格 */}
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c, idx) => {
          const isKept = kept.includes(c.id);
          const isSwiped = swiped.includes(c.id);
          const isPressing = pressing === c.id;
          if (isSwiped) {
            // 留空槽位 · 视觉一致性
            return <div key={c.id} className="aspect-[4/5] rounded-2xl border border-dashed border-warm-100 bg-warm-50/40" aria-hidden />;
          }
          const fallbackGrad = FALLBACK_GRADIENTS[idx % FALLBACK_GRADIENTS.length];
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => doKeep(c.id)}
              onTouchStart={() => startPress(c.id)}
              onTouchEnd={endPress}
              onTouchCancel={endPress}
              onMouseDown={() => startPress(c.id)}
              onMouseUp={endPress}
              onMouseLeave={endPress}
              onContextMenu={(e) => {
                e.preventDefault();
                doSwipe(c.id);
              }}
              aria-label={`风格 ${c.tags.join(' ')} · 点击喜欢 · 长按划走`}
              aria-pressed={isKept}
              className={`group relative aspect-[4/5] overflow-hidden rounded-2xl border-2 text-left transition active:scale-[0.98] ${
                isKept
                  ? 'border-primary shadow-rose-md'
                  : 'border-warm-100 shadow-warm-sm hover:border-warm-300'
              } ${isPressing ? 'opacity-60' : ''} disabled:opacity-50`}
            >
              {c.img_url ? (
                <img
                  src={c.img_url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => {
                    // 真图加载失败 · 隐藏让 fallback 渐变显出
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
              {/* 兜底渐变层(真图加载失败时由 onError 暴露) */}
              <div className={`absolute inset-0 flex items-center justify-center text-5xl ${fallbackGrad}`} aria-hidden>
                <span className="drop-shadow-sm">{emojiFor(c.tags)}</span>
              </div>
              {/* tags 角标 */}
              {c.tags.length > 0 && (
                <div className="absolute bottom-1.5 left-1.5 right-1.5 flex flex-wrap gap-1">
                  {c.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-black/45 px-1.5 py-0.5 text-[9.5px] font-medium text-white backdrop-blur"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {/* 已选 ✓ */}
              {isKept && (
                <div className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white shadow-rose-md">
                  <Check className="h-3.5 w-3.5" />
                </div>
              )}
              {/* 长按动画提示 */}
              {isPressing && (
                <div className="absolute inset-0 flex items-center justify-center bg-ink-900/40">
                  <X className="h-8 w-8 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 进度提示 */}
      <div className="text-center text-[11px] text-ink-500">
        {totalActed < 3 ? (
          <>再选/划 {3 - totalActed} 张就够了 · 我看反应就懂</>
        ) : remaining.length > 0 ? (
          <>已经够了 · 也可以继续看剩下的</>
        ) : (
          <>全过了一遍 · 我心里有数了</>
        )}
      </div>

      {/* 下一步 */}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => onSubmit(kept, swiped)}
        className="w-full rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white shadow-rose-md transition active:scale-[0.98] disabled:opacity-40"
      >
        下一步
      </button>
    </div>
  );
}
