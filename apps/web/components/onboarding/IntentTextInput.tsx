/**
 * 自由文本输入 · M03 F03-OB1 轮 1 城市 / 兜底输入
 *
 * 单行 input + 发送按钮 · 回车提交。
 */
'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

interface Props {
  placeholder?: string;
  initial?: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** 可选短建议(点击直接填入并提交)*/
  suggestions?: string[];
}

export function IntentTextInput({ placeholder, initial = '', onSubmit, disabled, suggestions }: Props) {
  const [value, setValue] = useState(initial);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  }

  return (
    <div className="space-y-2">
      {suggestions && suggestions.length > 0 && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              disabled={disabled}
              className="chip-quick whitespace-nowrap disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-warm-100 bg-white px-3 py-1.5">
        <input
          type="text"
          inputMode="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder ?? '输入'}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(value);
            }
          }}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-300 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => submit(value)}
          disabled={disabled || !value.trim()}
          aria-label="提交"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
