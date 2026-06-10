'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, clearAdminTokens, hasAdminToken, tryAdminRefresh } from '@/lib/api';

/** 后端返回的权限目录单条 */
interface PermCatalogItem {
  key: string;
  label: string;
  group: string;
  navHref: string | null;
  apiPrefixes: string[];
}

// ── 单色线图标 · 取代 emoji(高级后台一律单色线图标,不用彩色 emoji)──
type IconName =
  | 'home' | 'users' | 'clipboard' | 'ai' | 'megaphone'
  | 'globe' | 'wallet' | 'shield' | 'search' | 'bag' | 'sliders';

/** 导航项(叶节点) */
type NavItem = { href: string; label: string };
/** 三级子类(中间层,可折叠) */
type NavSection = { label: string; items: NavItem[] };
/** 导航组:要么 items(两级扁平),要么 sections(三级子类) */
type NavGroup = {
  label: string;
  icon: IconName;
} & ({ items: NavItem[]; sections?: never } | { sections: NavSection[]; items?: never });

// 11 个一级分组 · 反技术词反行话 · 2-4 字简洁 · 不加括号注释
const NAV_GROUPS: NavGroup[] = [
  {
    label: '首页',
    icon: 'home',
    items: [{ href: '/dashboard', label: '经营总览' }],
  },
  {
    label: '用户',
    icon: 'users',
    items: [
      { href: '/users/customers', label: '客户' },
      { href: '/users/therapists', label: '技师' },
      { href: '/therapists', label: '技师管控' },
      { href: '/verifications', label: '真人核验' },
    ],
  },
  {
    label: '业务',
    icon: 'clipboard',
    items: [
      { href: '/orders', label: '订单' },
      { href: '/matching-health', label: '派单监控' },
      { href: '/reviews', label: '评价审核' },
      { href: '/service-categories', label: '服务类型' },
      { href: '/shows', label: '节目监控' },
    ],
  },
  {
    label: 'AI 监管',
    icon: 'ai',
    sections: [
      {
        label: '规则与配置',
        items: [
          { href: '/ai/system', label: 'AI 规则' },
          { href: '/prompts', label: 'Prompt 模板' },
          { href: '/voice', label: '声音复刻' },
        ],
      },
      {
        label: '运行监控',
        items: [
          { href: '/ai/health', label: '健康仪表盘' },
          { href: '/ai/cost', label: '调用成本' },
          { href: '/ai/messages', label: 'AI 代发记录' },
        ],
      },
      {
        label: '内容审查',
        items: [
          { href: '/ai/conversations', label: '对话审查' },
          { href: '/ai/assistant/sessions', label: '助理对话' },
          { href: '/ai/redline', label: '违禁监控' },
        ],
      },
      {
        label: '智能与画像',
        items: [
          { href: '/ai/matching', label: '智能匹配' },
          { href: '/ai/assistant-profiles', label: '用户画像' },
        ],
      },
      {
        label: '应急管控',
        items: [
          { href: '/ai/kill-switch', label: '紧急关停' },
        ],
      },
    ],
  },
  {
    label: '群发',
    icon: 'megaphone',
    items: [
      { href: '/broadcasts', label: '群发记录' },
      { href: '/broadcasts/new', label: '新建群发' },
    ],
  },
  {
    label: '地理',
    icon: 'globe',
    items: [
      { href: '/geo/dashboard', label: '地域总览' },
      { href: '/geo/supply-demand', label: '供需缺口' },
      { href: '/geo/countries', label: '国家配置' },
      { href: '/geo/cities', label: '城市维护' },
      { href: '/geo/areas', label: '区域维护' },
    ],
  },
  {
    label: '资金',
    icon: 'wallet',
    sections: [
      {
        label: '资金流转',
        items: [
          { href: '/finance', label: '资金流水' },
          { href: '/withdrawals', label: '提现审核' },
          { href: '/platform-accounts', label: '平台收款' },
        ],
      },
      {
        label: '代理与积分',
        items: [
          { href: '/agents', label: '代理商' },
          { href: '/redeem', label: '积分回收' },
          { href: '/purchases', label: '采购仲裁' },
        ],
      },
      {
        label: '币种汇率',
        items: [
          { href: '/currencies', label: '法币字典' },
          { href: '/exchange-rates', label: '汇率维护' },
        ],
      },
    ],
  },
  {
    label: '风控',
    icon: 'shield',
    items: [
      { href: '/audit', label: '审核工单' },
      { href: '/risk', label: '风控事件' },
      { href: '/disputes', label: '心动金仲裁' },
      { href: '/system-errors', label: '系统报错与登录异常' },
      { href: '/tickets', label: '用户投诉' },
    ],
  },
  {
    label: '搜索',
    icon: 'search',
    items: [
      { href: '/search/analytics', label: '搜索分析' },
      { href: '/search/keywords', label: '热词运营' },
      { href: '/search/categories', label: '类目分布' },
    ],
  },
  {
    label: '橱窗',
    icon: 'bag',
    items: [
      { href: '/shop-items', label: '橱窗商品' },
      { href: '/shop-orders', label: '橱窗订单' },
      { href: '/shop-therapists', label: '技师经营' },
    ],
  },
  {
    label: '系统',
    icon: 'sliders',
    sections: [
      {
        label: '配置与开关',
        items: [
          { href: '/flags', label: '灰度开关' },
          { href: '/integrations', label: '第三方服务' },
          { href: '/mini-app', label: 'TG 小程序配置' },
          { href: '/splash', label: '启动页配图' },
        ],
      },
      {
        label: '权限与审计',
        items: [
          { href: '/roles', label: '账号角色' },
          { href: '/audit-log', label: '操作日志' },
        ],
      },
    ],
  },
];

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20v-1.2A4.3 4.3 0 0 1 7.8 14.5h2.4a4.3 4.3 0 0 1 4.3 4.3V20" />
      <path d="M16 14.7a3.6 3.6 0 0 1 4 3.6V20" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" />
    </>
  ),
  clipboard: (
    <>
      <rect x="4.5" y="4" width="15" height="16" rx="2.2" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3.2l1.7 4.4 4.4 1.7-4.4 1.7L12 15.4l-1.7-4.4L5.9 9.3l4.4-1.7L12 3.2z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10.5v3a1.2 1.2 0 0 0 1.2 1.2H7l5 3.5V6L7 9.3H5.2A1.2 1.2 0 0 0 4 10.5z" />
      <path d="M16 9.5a4 4 0 0 1 0 5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.3 4 5.4 4 8.5s-1.4 6.2-4 8.5c-2.6-2.3-4-5.4-4-8.5s1.4-6.2 4-8.5z" />
    </>
  ),
  wallet: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="2.4" />
      <path d="M3.5 10.5h17" />
      <circle cx="16.5" cy="14.5" r="1.1" />
    </>
  ),
  shield: <path d="M12 3.5l7 2.6v5.4c0 4-2.9 7-7 8.9-4.1-1.9-7-4.9-7-8.9V6.1l7-2.6z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.5 20.5-4-4" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8.5h12l-1 11.5H7L6 8.5z" />
      <path d="M9 8.5a3 3 0 0 1 6 0" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
};

function NavIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 shrink-0 text-ink-300 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  /** 高危未解决错误数 · 预警红点 */
  const [activeAlertCount, setActiveAlertCount] = useState(0);
  /** 当前用户拥有的权限 key 集 */
  const [myPermKeys, setMyPermKeys] = useState<Set<string> | null>(null);
  /** navHref → permissionKey 映射(用于导航过滤) */
  const [navHrefToPermKey, setNavHrefToPermKey] = useState<Map<string, string> | null>(null);

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

  // 拉取权限目录 + 当前用户权限 key——ready 后并行拉
  // 失败兜底策略:保持 null,渲染时 null 视为"显示全部"避免接口抖动锁死导航
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      try {
        const [myPerms, catalog] = await Promise.all([
          api.get<string[]>('/admin/my-permissions'),
          api.get<PermCatalogItem[]>('/admin/permissions/catalog'),
        ]);
        setMyPermKeys(new Set(myPerms));
        const m = new Map<string, string>();
        for (const item of catalog) {
          if (item.navHref) m.set(item.navHref, item.key);
        }
        setNavHrefToPermKey(m);
      } catch {
        // 失败时保持 null → 渲染逻辑显示全部(安全兜底:接口抖动不会锁死导航)
      }
    })();
  }, [ready]);

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

  // 按权限过滤 NAV_GROUPS:
  //   - myPermKeys/navHrefToPermKey 为 null(未加载完或拉取失败) → 显示全部(兜底)
  //   - 某菜单项 href 在 catalog 里有对应 permKey 且用户不含该 key → 隐藏
  //   - 某菜单项 href 不在 catalog(没有对应权限约束) → 显示
  //   - 某组所有项都被过滤掉 → 隐藏整组
  //   - sections 组:每个 section 过滤无权项,section 全空→隐藏,组所有 section 空→隐藏整组
  const filteredNavGroups = useMemo((): NavGroup[] => {
    if (myPermKeys === null || navHrefToPermKey === null) return NAV_GROUPS;

    const filterItem = (item: NavItem) => {
      const permKey = navHrefToPermKey.get(item.href);
      if (!permKey) return true; // 无权限约束 → 显示
      return myPermKeys.has(permKey);
    };

    const result: NavGroup[] = [];
    for (const g of NAV_GROUPS) {
      if (g.sections) {
        // 三级组:过滤每个 section 内的项,空 section 丢弃
        const filteredSections = g.sections
          .map((sec) => ({ ...sec, items: sec.items.filter(filterItem) }))
          .filter((sec) => sec.items.length > 0);
        if (filteredSections.length > 0) {
          result.push({ label: g.label, icon: g.icon, sections: filteredSections });
        }
      } else {
        // 两级组:维持现有逻辑
        const filteredItems = g.items.filter(filterItem);
        if (filteredItems.length > 0) {
          result.push({ label: g.label, icon: g.icon, items: filteredItems });
        }
      }
    }
    return result;
  }, [myPermKeys, navHrefToPermKey]);

  if (!ready)
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-300">加载中…</div>
    );

  if (roles.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="text-4xl text-ink-300">⊘</div>
        <h1 className="text-base font-semibold text-ink-900">无后台访问权限</h1>
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
    <div className="flex min-h-screen bg-ink-50">
      <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-ink-100 bg-white">
        {/* 品牌 · 克制的小标记 + 字标,不用大块粉色 */}
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-primary text-[13px] font-bold text-white shadow-sm">
            L
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-ink-900">LoveRush</div>
            <div className="text-[10.5px] tracking-wide text-ink-300">运营后台</div>
          </div>
        </div>

        {/* 预警 · 高危未解决错误 · 克制不刺眼 */}
        {activeAlertCount > 0 && (
          <button
            type="button"
            onClick={() => router.push('/system-errors')}
            className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-left text-xs text-rose-600 transition hover:bg-rose-100/70 active:scale-[0.99]"
          >
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
            <span className="flex-1">
              <strong className="font-semibold">{activeAlertCount}</strong> 个高危错误待处理
            </span>
            <span className="text-ink-300">›</span>
          </button>
        )}

        <nav className="flex-1 overflow-y-auto px-2.5 py-1">
          {filteredNavGroups.map((g) => (
            <NavGroup
              key={g.label}
              group={g}
              pathname={pathname}
              alertCount={g.label === '风控' ? activeAlertCount : 0}
            />
          ))}
        </nav>

        <div className="border-t border-ink-100 px-5 py-3.5">
          <div className="truncate text-[10.5px] tracking-wide text-ink-300">
            角色 · {roles.join(' / ')}
          </div>
          <button
            type="button"
            onClick={() => {
              clearAdminTokens();
              router.replace('/');
            }}
            className="mt-1 text-[12px] text-ink-500 transition-colors hover:text-primary"
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="h-screen flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

/** 两级导航项列表(组展开后的扁平项) */
function NavItemList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <div className="mb-1 mt-0.5 space-y-px">
      {items.map((it) => {
        const active = pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`relative flex items-center rounded-lg py-[7px] pl-[42px] pr-3 text-[13px] transition-colors ${
              active
                ? 'font-medium text-primary'
                : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
            }`}
          >
            {active && (
              <span className="absolute left-[15px] top-1/2 h-3.5 w-[2.5px] -translate-y-1/2 rounded-full bg-primary" />
            )}
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

/** 三级子类折叠块(第二层) */
function NavSectionBlock({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  const containsActive = section.items.some((i) => pathname.startsWith(i.href));
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div className="mb-px">
      {/* 子类标题:介于组和项之间,比组小/淡,缩进到图标右侧 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-[5px] pl-[42px] text-[11.5px] font-medium tracking-wide text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-600"
      >
        <span className="flex-1 text-left">{section.label}</span>
        {/* 细小 chevron,仅作折叠指示 */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-2.5 w-2.5 shrink-0 text-ink-300 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="space-y-px pb-0.5">
          {section.items.map((it) => {
            const active = pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`relative flex items-center rounded-lg py-[6px] pl-[54px] pr-3 text-[12.5px] transition-colors ${
                  active
                    ? 'font-medium text-primary'
                    : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
                }`}
              >
                {active && (
                  <span className="absolute left-[26px] top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
                )}
                {it.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavGroup({
  group,
  pathname,
  alertCount = 0,
}: {
  group: NavGroup;
  pathname: string;
  alertCount?: number;
}) {
  // 检测本组是否含活跃路由(两种形态都要检查)
  const containsActive = group.sections
    ? group.sections.some((sec) => sec.items.some((i) => pathname.startsWith(i.href)))
    : group.items.some((i) => pathname.startsWith(i.href));

  const [open, setOpen] = useState(containsActive);

  // 路径变化时,如果新路径落在本组,确保打开;不强制关闭其他组
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
          containsActive ? 'text-ink-900' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
        }`}
      >
        <NavIcon
          name={group.icon}
          className={`h-[18px] w-[18px] shrink-0 ${containsActive ? 'text-primary' : 'text-ink-300'}`}
        />
        <span className="flex-1 text-left">{group.label}</span>
        {alertCount > 0 && (
          <span className="rounded-full bg-rose-500 px-1.5 py-px text-[9px] font-bold leading-none text-white">
            {alertCount > 99 ? '99+' : alertCount}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        group.sections ? (
          // 三级:渲染子类折叠块
          <div className="mb-1 mt-0.5">
            {group.sections.map((sec) => (
              <NavSectionBlock key={sec.label} section={sec} pathname={pathname} />
            ))}
          </div>
        ) : (
          // 两级:渲染扁平项列表(维持原有行为)
          <NavItemList items={group.items} pathname={pathname} />
        )
      )}
    </div>
  );
}
