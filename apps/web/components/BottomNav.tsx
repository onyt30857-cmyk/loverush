'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Compass, MessageCircle, Calendar, User, Sparkles, LayoutGrid, ClipboardList } from 'lucide-react';
import { mutate } from 'swr';
import { apiGet } from '@/lib/api';

/**
 * tab → 对应 SWR key 预取映射
 * touchstart 时(用户手指还没抬,200-300ms 提前量)就开始拉数据
 * mutate(key, fetcher) 触发并缓存,点击进站时已就绪 → 0ms 骨架
 */
const TAB_PREFETCH: Record<string, string> = {
  '/home': '/therapists?limit=20',
  '/conversations': '/conversations',
  '/order': '/orders?role=customer&limit=50',
  '/me': '/dashboard/customer/me',
};

function prefetchTab(href: string) {
  const key = TAB_PREFETCH[href];
  if (key) void mutate(key, apiGet(key), { revalidate: false });
}

type CustomerKey = 'discover' | 'messages' | 'assistant' | 'orders' | 'me';
type TherapistKey = 'home' | 'orders' | 'schedule' | 'alter' | 'messages' | 'me';

// 客户端底部 5 tab · 对齐 v1/prototypes/index.html line 1504-1532
// 中央"助理"用大圆按钮 + sparkles (无 AI 文字 · BRAND.md §8 v5 政策)
export function CustomerBottomNav({ active }: { active: CustomerKey }) {
  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="relative grid grid-cols-5 items-end px-3 pb-2 pt-3">
        <SideTab icon={Compass} label="发现" href="/home" active={active === 'discover'} />
        <SideTab icon={MessageCircle} label="私聊" href="/conversations" active={active === 'messages'} />
        {/* 中央大按钮 · 助理 (无 AI 文字) */}
        <CenterTab href="/assistant" label="助理" active={active === 'assistant'} />
        <SideTab icon={Calendar} label="预约" href="/order" active={active === 'orders'} />
        <SideTab icon={User} label="我的" href="/me" active={active === 'me'} />
      </div>
    </nav>
  );
}

// 技师端底部 5 tab · 中央为 AI 分身(技师差异化核心)，私聊带未读角标
export function TherapistBottomNav({ active }: { active: TherapistKey }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const list = await apiGet<{ messageCount: number }[]>('/conversations');
        setUnread(list.filter((c) => c.messageCount > 0).length);
      } catch {
        // ignore — 角标取不到就不显示
      }
    })();
  }, []);

  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="relative grid grid-cols-5 items-end px-3 pb-2 pt-3">
        <SideTab icon={LayoutGrid} label="工作台" href="/t/home" active={active === 'home'} />
        <SideTab icon={ClipboardList} label="订单" href="/t/orders" active={active === 'orders'} />
        {/* 中央大按钮 · 排班(技师高频业务核心 · 替代之前的 AI 分身)
            AI 分身是低频配置 · 降到 /t/me 二级菜单 · 工作台首屏暴露 AI 价值(留下次做卡片) */}
        <CenterTab href="/t/schedule" label="排班" active={active === 'schedule'} icon={Calendar} />
        <SideTab icon={MessageCircle} label="私聊" href="/t/messages" active={active === 'messages'} badge={unread} />
        <SideTab icon={User} label="我的" href="/t/me" active={active === 'me'} />
      </div>
    </nav>
  );
}

/**
 * 中央"助理 / AI 分身"大圆按钮 · 全站统一视觉(M6 + P3 polish)
 *
 * 与 AppShell.tsx CustomerTabBar 中央按钮 100% 像素一致:
 *   shadow-rose-lg ring-4 ring-white transition active:scale-95
 *
 * 任意背景(白 / 灰 / gradient-soft 暖渐变)下都有清晰边界 +
 * 主 CTA 玫瑰阴影强调中央按钮的"焦点身份"。
 * 不被 active 状态影响视觉权重(仅文字色变化)。
 */
function CenterTab({
  href, label, active, icon: Icon = Sparkles,
}: {
  href: string;
  label: string;
  active?: boolean;
  icon?: typeof Sparkles;
}) {
  return (
    <div className="flex flex-col items-center">
      <Link
        href={href}
        className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-cta shadow-rose-lg ring-4 ring-white transition active:scale-95"
        aria-label={label}
      >
        <Icon className="h-6 w-6 text-white" />
      </Link>
      <span className={`mt-1 text-[9px] font-medium tracking-wider ${active ? 'text-primary' : 'text-warm-400'}`}>
        {label}
      </span>
    </div>
  );
}

function SideTab({
  icon: Icon,
  label,
  href,
  active,
  badge,
}: {
  icon: typeof Compass;
  label: string;
  href: string;
  active?: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-0.5 py-1"
      // touchstart 时(手指刚触屏,提前 200-300ms)预拉数据 · 点击进站时已就绪
      onTouchStart={() => prefetchTab(href)}
      onMouseEnter={() => prefetchTab(href)} // 桌面/iPad mouse 兼容
    >
      <span className="relative">
        <Icon className={`h-5 w-5 ${active ? 'text-primary' : 'text-ink-500'}`} />
        {badge != null && badge > 0 && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className={`mt-0.5 text-[9px] ${active ? 'font-medium text-primary' : 'text-ink-500'}`}>{label}</span>
    </Link>
  );
}
