/**
 * H5 应用外壳 · 顶部导航 + 底部 tab bar
 *
 * 390px 固定宽度，居中显示，移动端友好。
 */
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  hideTabBar?: boolean;
  right?: React.ReactNode;
}

export function AppShell({ children, title, showBack, hideTabBar, right }: AppShellProps) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col">
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
      <main className="flex-1 overflow-y-auto">{children}</main>
      {!hideTabBar && <TabBar />}
    </div>
  );
}

function TabBar() {
  const pathname = usePathname();
  const tabs = [
    { href: '/discover', label: '发现', icon: '🔍' },
    { href: '/conversations', label: '消息', icon: '💬' },
    { href: '/assistant', label: '助理', icon: '✨' },
    { href: '/me', label: '我的', icon: '👤' },
  ];
  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-ink-100 bg-white">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active ? 'text-primary' : 'text-ink-500'}`}
          >
            <span className="text-lg">{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
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
  const pathname = usePathname();
  const router = useRouter();
  const tabs = [
    { href: '/t/home', label: '主页', icon: '🏠' },
    { href: '/t/pending', label: '派单', icon: '📥' },
    { href: '/t/messages', label: '消息', icon: '💬' },
    { href: '/t/me', label: '我的', icon: '👤' },
  ];
  return (
    <div className="flex min-h-screen flex-col">
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
      <main className="flex-1 overflow-y-auto">{children}</main>
      {!hideTabBar && (
        <nav className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-ink-100 bg-white">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active ? 'text-primary' : 'text-ink-500'}`}
              >
                <span className="text-lg">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
