/**
 * AI 助理常驻浮动按钮（FAB） · M03
 *
 * - 右下角圆形按钮，主色 + 类人脉动动画
 * - 全客户端页面可见（在 /assistant 自身、技师端、闪屏页隐藏）
 * - 未读时按钮带红点（基于 localStorage：assistant_unread）
 * - aria-label / 键盘可操作（tab + Enter）
 * - 不依赖任何后端调用：纯前端导航元素，路由到 /assistant
 *
 * 注：客户端 ZERO AI 标识政策（BRAND.md §8 v5）— 不显示「AI」字样，
 *     但 PRD §1.1 要求"明示 AI"。本 FAB 视觉中性，由对话页头部用"明示 AI"小字标签承担。
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { t } from '@/lib/i18n';

// 不显示 FAB 的路径前缀（避开重复入口 / 闪屏 / 技师端）
const HIDDEN_PREFIXES = [
  '/assistant',
  '/splash',
  '/recover',
  '/register',
  '/t/',         // 技师端
  '/global-error',
];

export function AssistantFab() {
  const pathname = usePathname() ?? '/';
  const [hasUnread, setHasUnread] = useState(false);
  const [authed, setAuthed] = useState(false);

  // 客户端 mount 后检查 token + 未读状态（避免 SSR / hydration 抖动）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAuthed(!!window.localStorage.getItem('access_token'));
    setHasUnread(window.localStorage.getItem('assistant_unread') === '1');
    function onStorage(e: StorageEvent) {
      if (e.key === 'assistant_unread') setHasUnread(e.newValue === '1');
      if (e.key === 'access_token') setAuthed(!!e.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 客户登录 + 路径未屏蔽时才显示
  if (!authed) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;

  return (
    <Link
      href="/assistant"
      aria-label={t('assistant.fab.aria', '小助理 · 私人 AI 助理')}
      className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-cta shadow-rose-lg ring-4 ring-white/80 transition active:scale-95"
      style={{ animation: 'ai-ring 2.4s ease-out infinite' }}
    >
      {/* 脉动环（额外一层装饰），避免与 ring-4 冲突 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          boxShadow: '0 0 0 0 rgba(255, 85, 119, 0.45)',
          animation: 'fab-pulse 2.4s ease-out infinite',
        }}
      />
      <Sparkles className="relative h-6 w-6 text-white" />
      {hasUnread && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-danger-500 ring-2 ring-white"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
        </span>
      )}
      <style>{`
        @keyframes fab-pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 85, 119, 0.45); }
          70% { box-shadow: 0 0 0 14px rgba(255, 85, 119, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 85, 119, 0); }
        }
      `}</style>
    </Link>
  );
}

/** 给业务侧调用：来了新消息标记未读 / 进入对话清掉 */
export function markAssistantUnread(unread: boolean) {
  if (typeof window === 'undefined') return;
  if (unread) {
    window.localStorage.setItem('assistant_unread', '1');
  } else {
    window.localStorage.removeItem('assistant_unread');
  }
}
