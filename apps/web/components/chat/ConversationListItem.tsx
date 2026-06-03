/**
 * 私聊列表项 · 对齐微信 / iMessage (2026-06-03 单轨左滑重做)
 *
 * 删除交互(单轨 · 仅左滑):
 *   - 删除按钮接在主体右侧 · 默认溢出 overflow-hidden 裁剪框外 · 任何端都不常驻显示
 *   - 唯一露出方式: 往左滑(移动端手指 / 桌面端鼠标按住左拖) → 露出红色"删除"按钮
 *   - pointer events 统一处理触摸+鼠标 · 桌面也能左滑 · 不再有 hover ⋮ 常驻入口
 *
 * 变更记录:
 *   - 2026-06-03 砍桌面 hover ⋮ 菜单(用户要求"删除不要显示出来 · 只有左滑才显示")
 *     touch 事件升级为 pointer 事件 · 保留桌面删除能力(鼠标左拖)
 *   - 2026-06-03 遮挡方案从 "absolute 叠加 + 主体 w-full 盖" 改为 "flex 横向溢出 + 裁剪框"
 *     根因: 线上实测 absolute 叠加遮挡未生效 · 删除按钮真机常驻露出(部署成功非缓存)
 *     flex 溢出从结构保证默认不可见 · 不依赖 z-index 堆叠顺序
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

const ACTION_WIDTH = 72;     // 删除按钮宽度 · icon + '删除' 文字 · 对齐微信
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

  // 左滑手势状态 · 全平台统一(pointer events 兼容触摸+鼠标)
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

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return; // 仅主键 / 触摸 / 笔
    startXRef.current = e.clientX;
    startTimeRef.current = Date.now();
    movedRef.current = false;
    // 捕获指针:鼠标/手指拖出元素仍持续收到 move(桌面左拖关键)
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 个别浏览器不支持 · 忽略 */
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startXRef.current == null) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 4) movedRef.current = true;
    // 起始 offset:已打开时从 -ACTION_WIDTH 开始 · 否则从 0 开始
    const base = open ? -ACTION_WIDTH : 0;
    const next = base + delta;
    // 只允许 [-ACTION_WIDTH, 0] 范围 · 右滑超过 0 不响应
    const clamped = Math.max(-ACTION_WIDTH, Math.min(0, next));
    setTransform(clamped, false);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (startXRef.current == null) return;
    const endX = e.clientX;
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
      {/*
        滑动轨道:主体 + 删除按钮横向排列
        - 主体 w-full + shrink-0 占满裁剪框 100% 宽
        - 删除按钮 72px 接在主体右侧 → 整条轨道宽 = 100% + 72px · 溢出裁剪框右边界
        - 外层 overflow-hidden 裁掉溢出 → 删除按钮默认完全不可见(结构保证 · 不靠 z 叠加)
        - 仅左滑 translateX 负值把轨道左移 · 按钮才进入可视区
      */}
      <div
        ref={contentRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragStart={(e) => e.preventDefault()}
        className="flex"
        style={{ touchAction: 'pan-y', willChange: 'transform' }}
      >
        {/* 主体 · 占满裁剪框 · 白底 · 点击进会话 */}
        <div
          onClick={onMainClick}
          className="flex w-full shrink-0 items-center gap-3 bg-white px-4 py-3 transition-colors active:bg-warm-50 select-none cursor-pointer"
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

        {/* 删除按钮 · 72px · 默认溢出裁剪框外不可见 · 仅左滑露出 */}
        {onDelete ? (
          <button
            type="button"
            onClick={onDeleteClick}
            aria-label="删除会话"
            className="flex w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 bg-rose-500 text-white active:bg-rose-600"
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-[11px] font-medium">删除</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
