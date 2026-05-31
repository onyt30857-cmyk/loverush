'use client';

/**
 * 技师视角私聊骨架
 *
 * t/messages/[id]/page.tsx 复用 conversations/[id]/page.tsx 实现,
 * 所以这里骨架结构跟 conversations/[id]/loading.tsx 一致:
 *   header(返回 + 头像 + 名字 + 副标题) → 5 条交替气泡 → 底部输入栏
 *
 * 区别仅在数据层:同一 ChatHeader 组件 · 技师视角 header 处显示「客户名」、
 * 客户视角显示「技师名」 · 骨架阶段两侧无差。
 *
 * 单独建文件而非 re-export 是为了让 Next.js App Router 每条路由都精确命中
 * 自己的 loading.tsx(Suspense boundary 是路由级,不能跨段共享)。
 */

import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ui';

function TherapistChatSkeleton() {
  return (
    <div className="mobile-container flex flex-col bg-gradient-soft">
      {/* sticky ChatHeader · 技师视角:对方是客户 */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-warm-100 bg-white/95 px-3 py-2 backdrop-blur">
        <Shimmer className="h-8 w-8 rounded-full" />
        <Shimmer className="h-9 w-9 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* 客户名占位 · 客户名通常比技师昵称短一点 · 用 18 宽模拟 */}
          <Shimmer className="h-3.5 w-20 rounded-md" />
          <Shimmer className="h-2.5 w-14 rounded-md opacity-60" />
        </div>
        <Shimmer className="h-8 w-8 rounded-full opacity-60" />
      </header>

      {/* 消息流 · 跟客户视角镜像:对方=客户在左,自己=技师在右 */}
      <div className="flex-1 space-y-3 px-3 py-4">
        <div className="flex items-end gap-2">
          <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
          <Shimmer className="h-10 w-[60%] rounded-2xl rounded-bl-md" />
        </div>
        <div className="flex items-end justify-end gap-2">
          <Shimmer className="h-9 w-[44%] rounded-2xl rounded-br-md" />
        </div>
        <div className="flex items-end gap-2">
          <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <Shimmer className="h-9 w-[70vw] max-w-[280px] rounded-2xl rounded-bl-md" />
            <Shimmer className="h-2 w-14 rounded-md opacity-50" />
          </div>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Shimmer className="h-11 w-[54%] rounded-2xl rounded-br-md" />
        </div>
        <div className="flex items-end gap-2">
          <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
          <Shimmer className="h-9 w-[36%] rounded-2xl rounded-bl-md" />
        </div>
      </div>

      {/* sticky 底部输入栏 */}
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

export default function TherapistMessagesLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <TherapistChatSkeleton /> : null;
}
