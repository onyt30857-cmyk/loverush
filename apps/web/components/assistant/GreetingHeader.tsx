/**
 * 问候头 · M03 F03-Home1 区块 1
 *
 * 头像 Sparkles + 名字 + 在线状态 + 设置入口(/me/assistant-memory)。
 * 文案基于时段 + L1(后端拼好直接显示)。
 */
'use client';

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { GradientOrb } from '@/components/ui';
import type { AssistantGreeting } from './types';

interface Props {
  greeting: AssistantGreeting;
}

export function GreetingHeader({ greeting }: Props) {
  return (
    <header className="flex items-center gap-3 px-4 pt-4 pb-3">
      <GradientOrb size={48} icon="✨" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h1 className="truncate text-serif-cn text-[17px] font-semibold text-ink-800">小助理</h1>
          {/* 明示 AI 小字标签 · PRD §1.1 */}
          <span className="rounded bg-warm-100 px-1 py-0.5 text-[9px] font-medium tracking-wide text-warm-700">
            AI
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12.5px] leading-5 text-ink-600">{greeting.text}</p>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-400">
          <span className="online-dot" />
          <span>在线 · 免费聊</span>
        </div>
      </div>
      <Link
        href="/me/assistant-memory"
        aria-label="助理记忆设置"
        className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
      >
        <Settings2 className="h-5 w-5" />
      </Link>
    </header>
  );
}
