/**
 * 私聊列表项 · 对齐微信 / WhatsApp Web / Instagram DM (2026-06-03 重做)
 *
 * 删除交互(双轨 · 跟随平台习惯):
 *   - 移动(有 touch): 左滑显 icon-only 垃圾桶(64px · 无文字 · 对齐 iMessage 现代版)
 *   - 桌面(hover): 右侧 ⋮ 按钮 hover 才浮现 · 点击下拉 "删除聊天"(WhatsApp Web 标准)
 *   - 双轨不互斥 · 共用 onDelete 回调
 *
 * 错误自纠(2026-06-03 修常驻显示 bug):
 *   - 主体 div 加 w-full · 默认 translateX(0) 时把右侧按钮完全遮住
 *   - 桌面无 touch → 永远显主体 + hover ⋮ · 无意外露红
 *
 * 文档参考:
 *   - WhatsApp Web · hover 右侧 ⋮ → 弹菜单
 *   - Instagram DM · 左滑 icon-only / hover ⋮
 *   - 微信桌面 · 右键菜单(本实现暂不做 · 桌面用 ⋮ 入口对齐 WhatsApp)
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Trash2 } from 'lucide-react';
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

const ACTION_WIDTH = 64;     // 删除按钮宽度 · icon-only · 比原 80 收 16px
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
  // 桌面 hover 菜单状态 (⋮ 下拉)
  const [menuOpen, setMenuOpen] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const movedRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // ⋮ 桌面菜单 · 点别处自动关
  useEffect(() => {
    if (!menuOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [menuOpen]);

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
    <div className="group relative overflow-hidden">
      {/* 移动 swipe 删除 · icon-only 垃圾桶 · 64px · 默认被主体 w-full 完全遮住 */}
      {onDelete ? (
        <button
          type="button"
          onClick={onDeleteClick}
          aria-label="删除会话"
          className="absolute inset-y-0 right-0 flex w-16 items-center justify-center bg-rose-500 text-white active:bg-rose-600"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      ) : null}

      {/* 主体 · w-full 确保桌面默认完全遮住右侧按钮 · 可左滑 · 白底 */}
      <div
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={onMainClick}
        className="relative flex w-full items-center gap-3 bg-white px-4 py-3 transition-colors active:bg-warm-50 select-none cursor-pointer"
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

        {/* 桌面 hover 才显的 ⋮ 按钮 · 对齐 WhatsApp Web · 移动端 touch 设备隐藏 */}
        {onDelete ? (
          <div
            ref={menuRef}
            className="relative ml-1 hidden shrink-0 md:block"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="更多"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-ink-400 transition-all hover:bg-warm-100 hover:text-ink-700 ${
                menuOpen ? 'bg-warm-100 text-ink-700' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-10 mt-1 min-w-[120px] overflow-hidden rounded-xl bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)] ring-1 ring-warm-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除聊天
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
