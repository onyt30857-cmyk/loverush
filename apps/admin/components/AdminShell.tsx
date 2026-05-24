'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearAdminTokens, hasAdminToken } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: '总览', icon: '📊' },
  { href: '/users', label: '用户', icon: '🧑' },
  { href: '/audit', label: '审核', icon: '✅' },
  { href: '/tickets', label: '工单', icon: '🎫' },
  { href: '/risk', label: '风控', icon: '🛡' },
  { href: '/withdrawals', label: '提现', icon: '💸' },
  { href: '/flags', label: '灰度', icon: '🚦' },
  { href: '/roles', label: '角色', icon: '👤' },
  { href: '/audit-log', label: '审计日志', icon: '📜' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasAdminToken()) {
      router.replace('/');
      return;
    }
    api
      .get<string[]>('/me/roles')
      .then((r) => {
        setRoles(r);
        setReady(true);
      })
      .catch(() => {
        clearAdminTokens();
        router.replace('/');
      });
  }, [router]);

  if (!ready) return <div className="flex h-screen items-center justify-center text-sm text-ink-500">加载中…</div>;

  if (roles.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🚫</div>
        <h1 className="text-base font-semibold">无后台访问权限</h1>
        <p className="max-w-md text-sm text-ink-500">
          当前账号没有任何后台角色。请联系超管赋予 admin / cs / auditor / finance / ops 之一。
        </p>
        <button
          type="button"
          onClick={() => {
            clearAdminTokens();
            router.replace('/');
          }}
          className="btn-ghost"
        >
          退出
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-ink-100 bg-white">
        <div className="border-b border-ink-100 px-5 py-4">
          <div className="text-lg font-bold text-primary">LoveRush</div>
          <div className="text-xs text-ink-500">运营后台</div>
        </div>
        <nav className="p-3">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  active ? 'bg-primary/10 text-primary' : 'text-ink-700 hover:bg-ink-50'
                }`}
              >
                <span>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
          <div>角色：{roles.join(' / ')}</div>
          <button
            type="button"
            onClick={() => {
              clearAdminTokens();
              router.replace('/');
            }}
            className="mt-2 text-primary"
          >
            退出
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-ink-50 p-6">{children}</main>
    </div>
  );
}
