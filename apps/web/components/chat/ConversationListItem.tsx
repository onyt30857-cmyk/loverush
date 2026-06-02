/**
 * 私聊列表项 · 对齐微信 / WhatsApp / iMessage
 *
 * 布局:
 *   [头像 52]  对方昵称              ──时间──
 *              最后一条消息预览      [未读 badge]
 *
 * 删除交互:左滑露出红色"删除"按钮(iOS 标准)· 不再用长按
 *   - 左滑超过 40px 阈值 → 自动留在 -80px(露出删除按钮)
 *   - 左滑不到阈值 → 自动弹回 0
 *   - 已打开状态点击主体 → 关闭并不跳转(第一次点回收)
 *   - 关闭状态点击主体 → 跳转聊天页
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
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
  /** 左滑露出"删除"按钮 · 点击触发(沿用原 onLongPress 删除流程) */
  onDelete?: () => void;
}

const ACTION_WIDTH = 80;     // 删除按钮宽度
const TRIGGER_THRESHOLD = 40; // 滑动距离超过此值才打开

export function ConversationListItem(props: ConvItemProps) {
  const {
    href,
    counterpartyDisplayName,
    counterpartyAvatarUrl,
    fallbackName,
    lastMessagePreview,
    lastMessageAt,
    unreadCount,
    onDelete,
  } = props;

  const router = useRouter();

  const name = counterpartyDisplayName ?? fallbackName ?? '匿名';
  const preview = lastMessagePreview
    ? (lastMessagePreview.isEncrypted ? '🔐 加密消息' : lastMessagePreview.body || '尚无内容')
    : '尚无消息';
  const time = relativeTime(lastMessageAt);
  const unread = Math.max(0, unreadCount || 0);
  const fallback = (name || '').slice(0, 1);

  // 左滑手势状态
  const [open, setOpen] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const movedRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function setTransform(offset: number, animate: boolean) {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 220ms cubic-bezier(0.2, 0, 0.2, 1)' : 'none';
    el.style.transform = `translateX(${offset}px)`;
  }

  // 切换全局监听:同一时刻只一个打开 · 点别处关闭
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const el = contentRef.current?.parentElement;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
        setTransform(0, true);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0]!.clientX;
    startTimeRef.current = Date.now();
    movedRef.current = false;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startXRef.current == null) return;
    const delta = e.touches[0]!.clientX - startXRef.current;
    if (Math.abs(delta) > 4) movedRef.current = true;
    // 起始 offset:已打开时从 -ACTION_WIDTH 开始 · 否则从 0 开始
    const base = open ? -ACTION_WIDTH : 0;
    const next = base + delta;
    // 只允许 [-ACTION_WIDTH, 0] 范围 · 右滑超过 0 不响应
    const clamped = Math.max(-ACTION_WIDTH, Math.min(0, next));
    setTransform(clamped, false);
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (startXRef.current == null) return;
    const endX = e.changedTouches[0]!.clientX;
    const delta = endX - startXRef.current;
    startXRef.current = null;
    if (!movedRef.current) {
      // 没真正滑动 · 当点击处理(走 onClick handler)
      return;
    }
    // 决定打开/关闭:
    // - 关闭态左滑超 TRIGGER_THRESHOLD → 打开
    // - 打开态右滑回 TRIGGER_THRESHOLD → 关闭(用户'收回')
    let shouldOpen = open;
    if (open) {
      if (delta > TRIGGER_THRESHOLD) shouldOpen = false;
    } else {
      if (delta < -TRIGGER_THRESHOLD) shouldOpen = true;
    }
    setOpen(shouldOpen);
    setTransform(shouldOpen ? -ACTION_WIDTH : 0, true);
  }

  function onMainClick(e: React.MouseEvent) {
    if (movedRef.current) {
      // 刚滑过 · 不当点击
      e.preventDefault();
      movedRef.current = false;
      return;
    }
    if (open) {
      // 打开状态点主体 · 关闭 + 阻止跳转(标准 iOS 行为)
      e.preventDefault();
      setOpen(false);
      setTransform(0, true);
      return;
    }
    router.push(href);
  }

  function onDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    setTransform(0, true);
    onDelete?.();
  }

  return (
    <div className="relative overflow-hidden">
      {/* 红色"删除"按钮 · absolute 右侧 · open 时露出 */}
      {onDelete ? (
        <button
          type="button"
          onClick={onDeleteClick}
          aria-label="删除会话"
          className="absolute inset-y-0 right-0 flex w-20 items-center justify-center gap-1 bg-rose-500 text-white text-[13px] font-medium active:bg-rose-600"
        >
          <Trash2 className="h-4 w-4" />
          <span>删除</span>
        </button>
      ) : null}

      {/* 主体 · 可左滑 · 白底防红色透出 */}
      <div
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={onMainClick}
        className="flex items-center gap-3 bg-white px-4 py-3 transition-colors active:bg-warm-50 select-none cursor-pointer"
        style={{ touchAction: 'pan-y' }}
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
      </div>
    </div>
  );
}
