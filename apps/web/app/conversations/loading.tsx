'use client';

import { Search } from 'lucide-react';
import { CustomerBottomNav } from '@/components/BottomNav';
import { ListSkeleton } from '@/components/ui';

/**
 * 路由级 + 组件内共用的加载态：点击 tab 立即显示顶栏 + 底部 nav + 骨架，
 * 避免之前「整屏只有一个 LOADING 球、连导航都消失」的空等观感。
 */
export default function ConversationsLoading() {
  return (
    <div className="mobile-container bg-gradient-soft">
      <section className="px-4 pt-4">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 shadow-warm-xs">
          <Search className="h-4 w-4 text-ink-300" />
          <span className="text-[13px] text-ink-300">搜对话...</span>
        </div>
      </section>
      <ListSkeleton rows={6} />
      <CustomerBottomNav active="messages" />
    </div>
  );
}
