/**
 * 私聊对话页顶部 · 对齐微信/WhatsApp
 *
 * 布局:
 *   [← 返回]  [头像 36] 对方昵称          [⋮ 菜单(可选)]
 *                       (副标题/状态)
 *
 * 头像 + 昵称区可点(onHeaderClick),客户视角点击跳技师详情。
 */
'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Avatar, Shimmer } from '@/components/ui';

export interface ChatHeaderProps {
  displayName: string | null;
  avatarUrl?: string | null;
  /** 副标题:例如"在线"/"离线"/"刚刚活跃" · typing=true 时被"正在回复"覆盖 */
  subtitle?: string | null;
  /** 对方正在输入/回复 · true 时副标题位置显'正在回复...' + 三点跳动 */
  typing?: boolean;
  /** 右侧菜单按钮(可选,例如 ⋮ 弹更多) */
  rightSlot?: React.ReactNode;
  /** 返回路径 · 默认 router.back() */
  backHref?: string;
  /** 点击头像 + 昵称区域 · 通常跳对方详情 · 不传则不可点 */
  onHeaderClick?: () => void;
  /** 加载中 · 用骨架占位 · 避免显假"匿名"误导用户(Tony 铁律 "fallback 永不假装数据") */
  loading?: boolean;
}

/** typing 时的副标题 UI · 玫瑰色"正在回复" + 三点 bounce */
function TypingSubtitle() {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] leading-tight text-primary">
      <span>正在回复</span>
      <span className="flex gap-0.5">
        <span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
      </span>
    </div>
  );
}

export function ChatHeader({
  displayName,
  avatarUrl,
  subtitle,
  typing,
  rightSlot,
  backHref,
  onHeaderClick,
  loading,
}: ChatHeaderProps) {
  const router = useRouter();
  // 加载中 || 真无数据 都用骨架替代 (永不显"匿名"那种假数据)
  const isSkeleton = loading || (!displayName && !avatarUrl);
  const name = displayName ?? '';
  const fallback = (name || '·').slice(0, 1);

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

      {isSkeleton ? (
        <div className="flex flex-1 min-w-0 items-center gap-3">
          <Shimmer className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <Shimmer className="h-4 w-24 rounded" />
            <Shimmer className="h-2.5 w-16 rounded" />
          </div>
        </div>
      ) : onHeaderClick ? (
        <button
          type="button"
          onClick={onHeaderClick}
          aria-label={`查看 ${name} 详情`}
          className="flex flex-1 min-w-0 items-center gap-3 rounded-xl px-1 py-1 -mx-1 transition active:bg-ink-50"
        >
          <Avatar size={36} src={avatarUrl ?? undefined} fallback={fallback} />
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-[14.5px] font-semibold text-ink-900">{name}</div>
            {typing ? (
              <TypingSubtitle />
            ) : subtitle ? (
              <div className="truncate text-[10.5px] leading-tight text-ink-400">{subtitle}</div>
            ) : null}
          </div>
        </button>
      ) : (
        <>
          <Avatar size={36} src={avatarUrl ?? undefined} fallback={fallback} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14.5px] font-semibold text-ink-900">{name}</div>
            {typing ? (
              <TypingSubtitle />
            ) : subtitle ? (
              <div className="truncate text-[10.5px] leading-tight text-ink-400">{subtitle}</div>
            ) : null}
          </div>
        </>
      )}

      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </header>
  );
}
