'use client';

import Link from 'next/link';
import { Compass, MessageCircle, Calendar, User, Sparkles, Home as HomeIcon, ShoppingBag, Wallet } from 'lucide-react';

type CustomerKey = 'discover' | 'messages' | 'assistant' | 'orders' | 'me';
type TherapistKey = 'home' | 'orders' | 'schedule' | 'earnings' | 'me';

// 客户端底部 5 tab · 对齐 v1/prototypes/index.html line 1504-1532
// 中央"助理"用大圆按钮 + sparkles (无 AI 文字 · BRAND.md §8 v5 政策)
export function CustomerBottomNav({ active }: { active: CustomerKey }) {
  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="relative grid grid-cols-5 items-end px-3 pb-2 pt-3">
        <SideTab icon={Compass} label="发现" href="/home" active={active === 'discover'} />
        <SideTab icon={MessageCircle} label="私聊" href="/conversations" active={active === 'messages'} />
        {/* 中央大按钮 · 助理 (无 AI 文字) */}
        <div className="flex flex-col items-center">
          <Link
            href="/assistant"
            className={`-mt-7 flex h-14 w-14 items-center justify-center rounded-full shadow-warm-lg active:scale-95 ${
              active === 'assistant' ? 'bg-gradient-cta' : 'bg-gradient-cta'
            }`}
            aria-label="助理"
          >
            <Sparkles className="h-6 w-6 text-white" />
          </Link>
          <span className={`mt-1 text-[9px] font-medium tracking-wider ${active === 'assistant' ? 'text-primary' : 'text-warm-400'}`}>
            助理
          </span>
        </div>
        <SideTab icon={Calendar} label="预约" href="/order" active={active === 'orders'} />
        <SideTab icon={User} label="我的" href="/me" active={active === 'me'} />
      </div>
    </nav>
  );
}

// 技师端底部 5 tab · 对齐 technician-home.html
export function TherapistBottomNav({ active }: { active: TherapistKey }) {
  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="grid grid-cols-5 px-2 py-2">
        <SideTab icon={HomeIcon} label="工作台" href="/t/home" active={active === 'home'} />
        <SideTab icon={ShoppingBag} label="订单" href="/t/orders" active={active === 'orders'} />
        <SideTab icon={Calendar} label="日程" href="/t/orders" active={active === 'schedule'} />
        <SideTab icon={Wallet} label="收入" href="/t/me/earnings" active={active === 'earnings'} />
        <SideTab icon={User} label="我的" href="/t/me" active={active === 'me'} />
      </div>
    </nav>
  );
}

function SideTab({
  icon: Icon,
  label,
  href,
  active,
}: {
  icon: typeof Compass;
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 py-1">
      <Icon className={`h-5 w-5 ${active ? 'text-primary' : 'text-ink-500'}`} />
      <span className={`text-[9px] mt-0.5 ${active ? 'font-medium text-primary' : 'text-ink-500'}`}>{label}</span>
    </Link>
  );
}
