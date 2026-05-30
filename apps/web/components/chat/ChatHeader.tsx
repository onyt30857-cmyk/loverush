/**
 * 私聊对话页顶部 · 对齐微信/WhatsApp
 *
 * 布局:
 *   [← 返回]  [头像 36] 对方昵称          [⋮ 菜单(可选)]
 *                       (副标题/状态)
 */
'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Avatar } from '@/components/ui';

export interface ChatHeaderProps {
  displayName: string | null;
  avatarUrl?: string | null;
  /** 副标题:例如"在线"/"离线"/"刚刚活跃" */
  subtitle?: string | null;
  /** 右侧菜单按钮(可选,例如 ⋮ 弹更多) */
  rightSlot?: React.ReactNode;
  /** 返回路径 · 默认 router.back() */
  backHref?: string;
}

export function ChatHeader({ displayName, avatarUrl, subtitle, rightSlot, backHref }: ChatHeaderProps) {
  const router = useRouter();
  const name = displayName ?? '匿名';
  const fallback = name.slice(0, 1);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-warm-100 bg-white/95 px-3 py-2 backdrop-blur">
      <button
        type="button"
        onClick={() => (backHref ? router.push(backHref) : router.back())}
        aria-label="返回"
        className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-600 active:bg-ink-100"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <Avatar size={36} src={avatarUrl ?? undefined} fallback={fallback} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-ink-900">{name}</div>
        {subtitle ? (
          <div className="truncate text-[10.5px] leading-tight text-ink-400">{subtitle}</div>
        ) : null}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </header>
  );
}
