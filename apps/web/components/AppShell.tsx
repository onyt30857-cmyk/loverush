/**
 * H5 应用外壳 · 顶部导航 + 底部 tab bar (5-tab · 对齐 v1/prototypes/index.html)
 *
 * 390px 固定宽度，居中显示，移动端友好。
 */
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Compass,
  MessageCircle,
  Calendar,
  User,
  Sparkles,
  Home as HomeIcon,
  ShoppingBag,
  Wallet,
} from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  hideTabBar?: boolean;
  right?: React.ReactNode;
  /** 充满高度的页面（如聊天）：容器转为 flex 列，body 占满剩余空间且不加底部 padding */
  fill?: boolean;
}

export function AppShell({ children, title, showBack, hideTabBar, right, fill }: AppShellProps) {
  const router = useRouter();
  return (
    <div className={`mobile-container${fill ? ' flex flex-col overflow-hidden' : ''}`}>
      {(title || showBack || right) && (
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-ink-100 bg-white/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            {showBack && (
              <button
                type="button"
                onClick={() => router.back()}
                className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-700 active:bg-ink-100"
                aria-label="返回"
              >
                ←
              </button>
            )}
            {title && <h1 className="text-base font-semibold">{title}</h1>}
          </div>
          {right}
        </header>
      )}
      <div className={fill ? 'flex min-h-0 flex-1 flex-col' : hideTabBar ? '' : 'pb-20'}>{children}</div>
      {!hideTabBar && <CustomerTabBar />}
    </div>
  );
}

function CustomerTabBar() {
  const pathname = usePathname();
  const activeKey =
    pathname.startsWith('/conversations') ? 'messages'
    : pathname.startsWith('/assistant') ? 'assistant'
    : pathname.startsWith('/order') ? 'orders'
    : pathname.startsWith('/me') ? 'me'
    : 'discover';

  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="relative grid grid-cols-5 items-end px-3 pb-2 pt-3">
        <SideTab icon={Compass} label="发现" href="/home" active={activeKey === 'discover'} />
        <SideTab icon={MessageCircle} label="私聊" href="/conversations" active={activeKey === 'messages'} />
        <div className="flex flex-col items-center">
          <Link
            href="/assistant"
            className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-cta shadow-warm-lg active:scale-95"
            aria-label="助理"
          >
            <Sparkles className="h-6 w-6 text-white" />
          </Link>
          <span className={`mt-1 text-[9px] font-medium tracking-wider ${activeKey === 'assistant' ? 'text-primary' : 'text-warm-400'}`}>
            助理
          </span>
        </div>
        <SideTab icon={Calendar} label="预约" href="/order" active={activeKey === 'orders'} />
        <SideTab icon={User} label="我的" href="/me" active={activeKey === 'me'} />
      </div>
    </nav>
  );
}

export function TherapistShell({
  children,
  title,
  showBack,
  hideTabBar,
}: {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  hideTabBar?: boolean;
}) {
  const router = useRouter();
  return (
    <div className="mobile-container">
      {(title || showBack) && (
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-ink-100 bg-white/95 px-4 backdrop-blur">
          {showBack && (
            <button
              type="button"
              onClick={() => router.back()}
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full active:bg-ink-100"
            >
              ←
            </button>
          )}
          {title && <h1 className="text-base font-semibold">{title}</h1>}
        </header>
      )}
      <div className={hideTabBar ? '' : 'pb-20'}>{children}</div>
      {!hideTabBar && <TherapistTabBar />}
    </div>
  );
}

function TherapistTabBar() {
  const pathname = usePathname();
  const activeKey =
    pathname.startsWith('/t/orders') ? 'orders'
    : pathname.startsWith('/t/me/earnings') ? 'earnings'
    : pathname.startsWith('/t/me') ? 'me'
    : 'home';

  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="grid grid-cols-5 px-2 py-2">
        <SideTab icon={HomeIcon} label="工作台" href="/t/home" active={activeKey === 'home'} />
        <SideTab icon={ShoppingBag} label="订单" href="/t/orders" active={activeKey === 'orders'} />
        <SideTab icon={Calendar} label="日程" href="/t/orders" active={false} />
        <SideTab icon={Wallet} label="收入" href="/t/me/earnings" active={activeKey === 'earnings'} />
        <SideTab icon={User} label="我的" href="/t/me" active={activeKey === 'me'} />
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
      <span className={`mt-0.5 text-[9px] ${active ? 'font-medium text-primary' : 'text-ink-500'}`}>{label}</span>
    </Link>
  );
}
