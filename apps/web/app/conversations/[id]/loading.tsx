'use client';

/**
 * 私聊页骨架 · 客户视角
 *
 * 形状对齐:
 *   sticky ChatHeader(返回 + 头像 + 昵称 + 副标题)
 *   消息区(左右交替气泡 5 条)
 *   sticky 底部输入栏(翻译按钮 + 输入框 + 发送)
 *
 * 高度跟真页面对齐 · 数据到达不大跳。200ms 防闪。
 */

import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ui';

function ChatSkeleton() {
  return (
    <div className="mobile-container flex flex-col bg-gradient-soft">
      {/* sticky 顶部 ChatHeader · 复用 page 同款 layout */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-warm-100 bg-white/95 px-3 py-2 backdrop-blur">
        <Shimmer className="h-8 w-8 rounded-full" />
        <Shimmer className="h-9 w-9 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Shimmer className="h-3.5 w-24 rounded-md" />
          <Shimmer className="h-2.5 w-16 rounded-md opacity-60" />
        </div>
        <Shimmer className="h-8 w-8 rounded-full opacity-60" />
      </header>

      {/* 消息流 · 左右交替气泡 · 宽度模拟真实文本 */}
      <div className="flex-1 space-y-3 px-3 py-4">
        {/* 对方 · 左 · 长气泡 */}
        <div className="flex items-end gap-2">
          <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
          <Shimmer className="h-10 w-[64%] rounded-2xl rounded-bl-md" />
        </div>
        {/* 自己 · 右 · 短 */}
        <div className="flex items-end justify-end gap-2">
          <Shimmer className="h-9 w-[40%] rounded-2xl rounded-br-md" />
        </div>
        {/* 对方 · 左 · 双行 */}
        <div className="flex items-end gap-2">
          <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Shimmer className="h-9 w-[72vw] max-w-[280px] rounded-2xl rounded-bl-md" />
            <Shimmer className="h-2 w-16 rounded-md opacity-50" />
          </div>
        </div>
        {/* 自己 · 右 · 中等 */}
        <div className="flex items-end justify-end gap-2">
          <Shimmer className="h-11 w-[58%] rounded-2xl rounded-br-md" />
        </div>
        {/* 对方 · 左 · 短气泡 */}
        <div className="flex items-end gap-2">
          <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
          <Shimmer className="h-9 w-[32%] rounded-2xl rounded-bl-md" />
        </div>
      </div>

      {/* sticky 底部输入栏 · 翻译按钮 + 输入框 + 发送 */}
      <div className="sticky bottom-0 z-20 border-t border-warm-100 bg-white/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
          <Shimmer className="h-9 flex-1 rounded-full" />
          <Shimmer className="h-9 w-16 shrink-0 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export default function ConversationLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <ChatSkeleton /> : null;
}
