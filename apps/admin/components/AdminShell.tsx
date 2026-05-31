'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearAdminTokens, hasAdminToken, tryAdminRefresh } from '@/lib/api';

// 10 个一级分组 · 反技术词反行话 · 2-4 字简洁 · 不加括号注释
const NAV_GROUPS: Array<{
  label: string;
  icon: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    label: '首页',
    icon: '📊',
    items: [{ href: '/dashboard', label: '经营总览' }],
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
      { href: '/matching-health', label: '派单监控' },
      { href: '/reviews', label: '评价审核' },
    ],
  },
  {
    label: 'AI 监管',
    icon: '🤖',
    items: [
      { href: '/ai/system', label: 'AI 规则' },
      { href: '/ai/health', label: '健康仪表盘' },
      { href: '/ai/assistant/sessions', label: '助理对话' },
      { href: '/ai/redline', label: '违禁监控' },
      { href: '/ai/cost', label: '调用成本' },
      { href: '/ai/messages', label: 'AI 代发记录' },
      { href: '/ai/assistant-profiles', label: '用户画像' },
    ],
  },
  {
    label: '群发',
    icon: '📣',
    items: [
      { href: '/broadcasts', label: '群发记录' },
      { href: '/broadcasts/new', label: '新建群发' },
    ],
  },
  {
    label: '地理',
    icon: '🌏',
    items: [
      { href: '/geo/dashboard', label: '地域总览' },
      { href: '/geo/supply-demand', label: '供需缺口' },
      { href: '/geo/cities', label: '城市维护' },
      { href: '/geo/areas', label: '区域维护' },
    ],
  },
  {
    label: '资金',
    icon: '💰',
    items: [
      { href: '/finance', label: '资金流水' },
      { href: '/withdrawals', label: '提现审核' },
      { href: '/agents', label: '代理商' },
    ],
  },
  {
    label: '风控',
    icon: '🛡',
    items: [
      { href: '/audit', label: '审核工单' },
      { href: '/risk', label: '风控事件' },
      { href: '/system-errors', label: '系统报错与登录异常' },
      { href: '/tickets', label: '用户投诉' },
    ],
  },
  {
    label: '搜索',
    icon: '🔍',
    items: [
      { href: '/search/analytics', label: '搜索分析' },
      { href: '/search/keywords', label: '热词运营' },
      { href: '/search/categories', label: '类目分布' },
    ],
  },
  {
    label: '系统',
    icon: '⚙️',
    items: [
      { href: '/flags', label: '灰度开关' },
      { href: '/roles', label: '账号角色' },
      { href: '/splash', label: '启动页配图' },
      { href: '/audit-log', label: '操作日志' },
    ],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  /** 高危未解决错误数 · 预警红点 */
  const [activeAlertCount, setActiveAlertCount] = useState(0);

  useEffect(() => {
    // 行业惯例:关浏览器再开,access_token(1h)过期后,refresh_token(30d)还在 →
    // 主动续命一次,而不是直接踢回登录页。对齐客户端 auth.tsx 的 refresh-on-bootstrap。
    void (async () => {
      if (!hasAdminToken()) {
        const ok = await tryAdminRefresh();
        if (!ok) {
          router.replace('/');
          return;
        }
      }
      try {
        const r = await api.get<string[]>('/me/roles');
        setRoles(r);
        setReady(true);
      } catch {
        clearAdminTokens();
        router.replace('/');
      }
    })();
  }, [router]);

  // 预警轮询 · 每 60s 拉一次高危未解决错误数(只在有 admin/ops/auditor 角色时)
  useEffect(() => {
    if (!ready || roles.length === 0) return;
    const hasAccess = roles.some((r) => ['admin', 'ops', 'auditor'].includes(r));
    if (!hasAccess) return;

    const fetchAlert = async () => {
      try {
        const data = await api.get<{ count: number; threshold: number }>(
          '/admin/system-errors/active-count',
        );
        setActiveAlertCount(data.count);
      } catch {
        // 静默 · 不打扰
      }
    };
    void fetchAlert();
    const timer = setInterval(fetchAlert, 60_000);
    return () => clearInterval(timer);
  }, [ready, roles]);

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
        {/* 预警 banner · 高危未解决错误 · 点击跳系统报错页 */}
        {activeAlertCount > 0 && (
          <button
            type="button"
            onClick={() => router.push('/system-errors')}
            className="mx-3 my-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-left text-xs text-rose-700 hover:bg-rose-100 active:scale-[0.99]"
          >
            <span className="animate-pulse text-base">⚠️</span>
            <span className="flex-1">
              <strong>{activeAlertCount}</strong> 个高危错误未处理
            </span>
            <span className="text-[10px]">→</span>
          </button>
        )}
        <nav className="p-3">
          {NAV_GROUPS.map((g) => (
            <NavGroup
              key={g.label}
              group={g}
              pathname={pathname}
              alertCount={g.label === '风控' ? activeAlertCount : 0}
            />
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
  alertCount = 0,
}: {
  group: { label: string; icon: string; items: Array<{ href: string; label: string }> };
  pathname: string;
  alertCount?: number;
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
        {alertCount > 0 && (
          <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
            {alertCount > 99 ? '99+' : alertCount}
          </span>
        )}
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
