'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearAdminTokens, hasAdminToken } from '@/lib/api';

// 6 个一级分组 · 按运营工作流而非技术模块切
const NAV_GROUPS: Array<{
  label: string;
  icon: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    label: '概览',
    icon: '📊',
    items: [{ href: '/dashboard', label: '运营总览' }],
  },
  {
    label: '用户',
    icon: '🌸',
    items: [
      { href: '/users/customers', label: '客户' },
      { href: '/users/therapists', label: '技师' },
      { href: '/verifications', label: '真人核验' },
    ],
  },
  {
    label: '业务',
    icon: '📋',
    items: [
      { href: '/orders', label: '订单' },
      { href: '/matching-health', label: '派单健康' },
      { href: '/reviews', label: '评价管理' },
    ],
  },
  {
    label: 'AI 治理',
    icon: '🤖',
    items: [
      { href: '/ai/assistant/sessions', label: '助理会话回放' },
      { href: '/ai/redline', label: '红线监控' },
      { href: '/ai/cost', label: '成本看板' },
      { href: '/ai/messages', label: '代发审计' },
      { href: '/ai/assistant-profiles', label: '客户画像' },
    ],
  },
  {
    label: '资金',
    icon: '💰',
    items: [
      { href: '/finance', label: '资金看板' },
      { href: '/withdrawals', label: '提现' },
      { href: '/agents', label: '代理批发' },
    ],
  },
  {
    label: '风控合规',
    icon: '🛡',
    items: [
      { href: '/audit', label: '审核工单' },
      { href: '/risk', label: '风控事件' },
      { href: '/tickets', label: '客诉工单' },
    ],
  },
  {
    label: '搜索发现',
    icon: '🔍',
    items: [
      { href: '/search/analytics', label: 'Query 看板' },
      { href: '/search/keywords', label: '热门词运营' },
      { href: '/search/categories', label: '类目网格' },
    ],
  },
  {
    label: '系统',
    icon: '⚙️',
    items: [
      { href: '/flags', label: '灰度发布' },
      { href: '/roles', label: '角色权限' },
      { href: '/audit-log', label: '审计日志' },
    ],
  },
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
          {NAV_GROUPS.map((g) => (
            <NavGroup key={g.label} group={g} pathname={pathname} />
          ))}
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

function NavGroup({
  group,
  pathname,
}: {
  group: { label: string; icon: string; items: Array<{ href: string; label: string }> };
  pathname: string;
}) {
  // 默认:含活跃路由的组自动展开;其他默认折叠
  const containsActive = group.items.some((i) => pathname.startsWith(i.href));
  const [open, setOpen] = useState(containsActive);

  // 路径变化时,如果新路径落在本组,确保打开;不强制关闭其他组
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
          containsActive ? 'text-primary' : 'text-ink-500 hover:text-ink-700'
        }`}
      >
        <span className="text-sm">{group.icon}</span>
        <span className="flex-1 text-left">{group.label}</span>
        <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && (
        <div className="ml-2 mt-0.5 border-l border-ink-100 pl-2">
          {group.items.map((it) => {
            const active = pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                  active ? 'bg-primary/10 font-medium text-primary' : 'text-ink-700 hover:bg-ink-50'
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
