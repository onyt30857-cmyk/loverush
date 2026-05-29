/**
 * 助理 home 输入条 · M03 v3 区块 5
 *
 * 设计反复历史:
 *  v1 · onFocus → router.push 跳页(8 标杆调研后觉得反直觉)
 *  v3 · onFocus → 就地 inline 输入(键盘弹起 home 内聊)
 *  v3.1 · 用户体验后反馈"全屏对话按钮去掉,点击下面对话就跳全屏对话页面"
 *        → 改回"点击就跳全屏对话页"(深度对话独立页 · home 是导览/推荐)
 *
 * 当前行为:
 *  - input focus / click → 直接调 onSend(value) → 父级 router.push('/assistant/chat?intent_seed=...')
 *  - chip 点击 → onSend(intent_seed)
 *  - 发送按钮 → onSend(value)
 *  - ref.focusAndPrefill 保留(技师卡"聊"按钮调用时填值后立刻跳页)
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
      // 外部预填 · 直接跳页带 query(不再就地 focus)
      onSend(text);
    },
  }));

  // 防止外部预填后陷入受控陷阱:输入框始终是受控
  useEffect(() => {
    // noop · 受控
  }, []);

  function handleSend(text: string) {
    if (disabled) return;
    // 允许空(空时父级 router.push('/assistant/chat'),否则带 intent_seed)
    onSend(text.trim());
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
          onFocus={(e) => {
            // 点击/focus 输入框 → 立即跳全屏对话页(home 不做就地聊)
            e.currentTarget.blur();
            handleSend(value);
          }}
          onClick={() => handleSend(value)}
          placeholder={placeholder}
          aria-label="跟小助理说"
          disabled={disabled}
          readOnly
          className="min-w-0 flex-1 cursor-pointer bg-transparent px-2 py-1.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-400 disabled:opacity-50"
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
