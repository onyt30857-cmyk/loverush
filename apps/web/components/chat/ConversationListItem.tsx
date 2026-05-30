/**
 * 私聊列表项 · 对齐微信 / WhatsApp / iMessage
 *
 * 布局:
 *   [头像 52]  对方昵称              ──时间──
 *              最后一条消息预览      [未读 badge]
 */
'use client';

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
  } = props;

  const name = counterpartyDisplayName ?? fallbackName ?? '匿名';
  const preview = lastMessagePreview
    ? (lastMessagePreview.isEncrypted ? '🔐 加密消息' : lastMessagePreview.body || '尚无内容')
    : '尚无消息';
  const time = relativeTime(lastMessageAt);
  const unread = Math.max(0, unreadCount || 0);
  const fallback = (name || '').slice(0, 1);

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition active:bg-warm-50"
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
