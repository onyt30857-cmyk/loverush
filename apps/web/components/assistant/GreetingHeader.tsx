/**
 * 问候头 · M03 v3 区块 1
 *
 * 头像 Sparkles + 名字 + AI 标签 + 设置入口(/me/assistant-memory)。
 * 文案基于时段 + L1(后端拼好直接显示)。
 *
 * v3 新增:`days_since_first` 显示("第 23 天")· 信任货币 · 让老用户感受"陪伴感"。
 */
'use client';

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import type { AssistantGreeting } from './types';

interface Props {
  greeting: AssistantGreeting;
}

export function GreetingHeader({ greeting }: Props) {
  const days = greeting.days_since_first;
  return (
    <header className="flex items-center gap-3 px-4 pt-4 pb-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h1 className="truncate text-serif-cn text-[17px] font-semibold text-ink-800">小助理</h1>
          {/* 明示 AI 小字标签 · PRD §1.1 */}
          <span className="rounded bg-warm-100 px-1 py-0.5 text-[9px] font-medium tracking-wide text-warm-700">
            AI · 免费
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12.5px] leading-5 text-ink-600">
          {greeting.text}
          {days != null && days > 0 && (
            <span className="ml-1 text-ink-400">· 第 {days} 天</span>
          )}
        </p>
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
