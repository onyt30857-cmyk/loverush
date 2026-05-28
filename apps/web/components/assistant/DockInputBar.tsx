/**
 * 常驻输入条 · M03 F03-Home1 区块 5
 *
 * 不在 home 直接发消息(避免冷启动空白对话感) ·
 * 点击 / focus / 提交 → 跳 /assistant/chat?intent_seed=xxx,
 * 由对话页接管打字 + 流式回复体验。
 *
 * 视觉对齐对话页底部输入栏,无缝感(用户感知:输入条是相同的,只是页面变了)。
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

export function DockInputBar() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function go(text: string) {
    const trimmed = text.trim();
    if (trimmed) {
      router.push(`/assistant/chat?intent_seed=${encodeURIComponent(trimmed)}`);
    } else {
      router.push('/assistant/chat');
    }
  }

  return (
    <div className="sticky bottom-0 z-10 mt-2 border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
      <div className="flex items-center gap-2 rounded-2xl bg-ink-50 px-2 py-1.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center text-warm-500" aria-hidden>
          <Sparkles className="h-5 w-5" />
        </span>
        <input
          type="text"
          inputMode="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {
            // 直接进对话页(防止键盘弹起+撤回的尴尬)
            go(value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(value);
            }
          }}
          placeholder="跟小助理说点什么…"
          aria-label="开始跟小助理对话"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-400"
        />
        <button
          type="button"
          onClick={() => go(value)}
          aria-label="进入对话"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md active:scale-95"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      {/* 合规标识已在 GreetingHeader 顶部(AI 标签 + "在线 · 免费聊"),此处不重复 */}
    </div>
  );
}
