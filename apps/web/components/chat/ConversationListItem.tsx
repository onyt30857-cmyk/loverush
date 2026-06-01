/**
 * 私聊列表项 · 对齐微信 / WhatsApp / iMessage
 *
 * 布局:
 *   [头像 52]  对方昵称              ──时间──
 *              最后一条消息预览      [未读 badge]
 */
'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { relativeTime } from './relativeTime';

export interface ConvItemProps {
  href: string;
  counterpartyDisplayName: string | null;
  counterpartyAvatarUrl: string | null;
  /** 兜底显示用 · 例如 user_id 前 8 位 */
  fallbackName?: string;
  lastMessagePreview: { body: string; isEncrypted?: boolean } | null;
  lastMessageAt: string | Date | null;
  unreadCount: number;
  /** 长按触发(500ms) · 参照微信 · 用于弹删除/操作菜单 */
  onLongPress?: () => void;
}

export function ConversationListItem(props: ConvItemProps) {
  const {
    href,
    counterpartyDisplayName,
    counterpartyAvatarUrl,
    fallbackName,
    lastMessagePreview,
    lastMessageAt,
    unreadCount,
    onLongPress,
  } = props;

  const name = counterpartyDisplayName ?? fallbackName ?? '匿名';
  const preview = lastMessagePreview
    ? (lastMessagePreview.isEncrypted ? '🔐 加密消息' : lastMessagePreview.body || '尚无内容')
    : '尚无消息';
  const time = relativeTime(lastMessageAt);
  const unread = Math.max(0, unreadCount || 0);
  const fallback = (name || '').slice(0, 1);

  // 长按检测 · 500ms 触发 onLongPress 并阻断后续 click 跳转
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const startLong = () => {
    if (!onLongPress) return;
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      try {
        // 移动端轻微震动反馈(支持时)
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
      } catch { /* iOS Safari 早期不支持 vibrate · 静默 */ }
      onLongPress();
    }, 500);
  };
  const cancelLong = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const handleClick = (e: React.MouseEvent) => {
    if (firedRef.current) {
      // 长按已触发 · 阻止 Link click 跳转 (用户意图是弹菜单不是进会话)
      e.preventDefault();
      firedRef.current = false;
    }
  };

  return (
    <Link
      href={href}
      onTouchStart={startLong}
      onTouchEnd={cancelLong}
      onTouchCancel={cancelLong}
      onMouseDown={startLong}
      onMouseUp={cancelLong}
      onMouseLeave={cancelLong}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress();
        }
      }}
      onClick={handleClick}
      className="flex items-center gap-3 px-4 py-3 transition active:bg-warm-50 select-none"
    >
      <div className="relative shrink-0">
        <Avatar size={52} src={counterpartyAvatarUrl ?? undefined} fallback={fallback} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white shadow-sm ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-[14.5px] font-medium text-ink-900">{name}</div>
          <div className="shrink-0 text-[10.5px] text-ink-400">{time}</div>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <div className="truncate text-[12px] text-ink-500">{preview}</div>
        </div>
      </div>
    </Link>
  );
}
