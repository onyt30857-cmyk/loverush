/**
 * 选项气泡组 · M03 F03-OB1 轮 2/4/5
 *
 * 多个选项纵向排列 · 选中即提交 · 支持触觉反馈。
 */
'use client';

import type { OnboardingOption } from './types';

interface Props {
  options: OnboardingOption[];
  /** 是否允许多选 · 默认单选 */
  multi?: boolean;
  /** 当前已选值 */
  selected: string[];
  onSelect: (values: string[]) => void;
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

export function OptionPills({ options, multi = false, selected, onSelect, disabled }: Props) {
  function toggle(v: string) {
    vibrate();
    if (multi) {
      if (selected.includes(v)) {
        onSelect(selected.filter((x) => x !== v));
      } else {
        onSelect([...selected, v]);
      }
    } else {
      onSelect([v]);
    }
  }

  return (
    <div className="space-y-2" role="group">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => toggle(o.value)}
            aria-pressed={on}
            className={`flex w-full items-center gap-2 rounded-2xl border px-4 py-3 text-left text-[13.5px] transition active:scale-[0.99] ${
              on
                ? 'border-primary bg-primary/5 text-ink-800 shadow-rose-md'
                : 'border-warm-100 bg-white text-ink-700 hover:border-warm-300'
            } disabled:opacity-50`}
          >
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-primary' : 'border-warm-200'}`} aria-hidden>
              {on && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="flex-1">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
