/**
 * Inline 输入框(关键 · 永不跳页)· M03 v3 区块 5
 *
 * 痛点:老版 DockInputBar.onFocus 直接 router.push('/assistant/chat') · 用户连键盘都没看见.
 *
 * 8 大 AI 标杆共识 → 改为就地输入:
 *  - input focus 不跳页 · 键盘弹起 · 浏览器自动把输入框上浮
 *  - Enter / 点发送 → 调外部 onSend(text)
 *  - smart_chips 在输入框上方横滑 · 点击 chip 直接 onSend(chip.intent_seed)
 *  - 接受 ref · 外部预填(技师卡"聊"按钮 / Memory CTA "先聊聊")自动 focus + 填值
 *
 * 视觉:常驻 sticky 底 · 暖色边界 · 圆角输入框 + 麦克风(占位) + 发送按钮.
 */
'use client';

import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { Mic, Send } from 'lucide-react';
import type { SmartChip } from './types';

export interface InlineChatInputHandle {
  focusAndPrefill: (text: string) => void;
}

interface Props {
  chips?: SmartChip[];
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const InlineChatInput = forwardRef<InlineChatInputHandle, Props>(function InlineChatInput(
  { chips, onSend, disabled, placeholder = '跟我说...' },
  ref,
) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusAndPrefill(text: string) {
      setValue(text);
      // 滚到自己 + 立刻 focus
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  }));

  // 防止外部预填后陷入受控陷阱:输入框始终是受控
  useEffect(() => {
    // noop · 受控
  }, []);

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <div
      ref={containerRef}
      className="sticky bottom-0 z-30 mt-2 border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur"
    >
      {/* 上方 smart chips 横滑 */}
      {chips && chips.length > 0 && (
        <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => handleSend(c.intent_seed)}
              className="chip-quick whitespace-nowrap"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-2xl border border-warm-100 bg-ink-50 px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSend(value);
            }
          }}
          placeholder={placeholder}
          aria-label="跟小助理说"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-400 disabled:opacity-50"
        />
        <button
          type="button"
          disabled
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-300"
          aria-label="语音(开发中)"
          title="语音输入开发中"
        >
          <Mic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => handleSend(value)}
          disabled={disabled || !value.trim()}
          aria-label="发送"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md active:scale-95 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});
