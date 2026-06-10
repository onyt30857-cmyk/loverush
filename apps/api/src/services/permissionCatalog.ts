/**
 * 权限 Catalog · 单一事实源
 *
 * 每个权限对应 AdminShell 的一个菜单项。
 * catalog 由前端导航过滤(P2)、后端网关(P3)、权限矩阵 UI(P4) 共同读取。
 *
 * key 命名规则：navHref 去前导 / 后将 / 换成 .（如 /ai/system → ai.system）。
 * apiPrefixes：该菜单页对应的后端 /admin/* 路径前缀；
 *   - 拿不准的标注 TODO，P3 网关落地时补全。
 */

export interface Permission {
  key:         string;
  label:       string;       // 菜单项中文名
  group:       string;       // 所属一级菜单组中文名
  navHref:     string;       // AdminShell item.href
  apiPrefixes: string[];     // 后端 API 前缀（P3 网关用）
}

/** ── 所有权限条目（对应 AdminShell NAV_GROUPS 的逐项 item） ── */
export const PERMISSIONS: Permission[] = [
  // ─── 首页 ──────────────────────────────────────────────────────────────────
  {
    key: 'dashboard',
    label: '经营总览',
    group: '首页',
    navHref: '/dashboard',
    apiPrefixes: ['/admin/dashboard'],
  },

  // ─── 用户 ──────────────────────────────────────────────────────────────────
  {
    key: 'users.customers',
    label: '客户',
    group: '用户',
    navHref: '/users/customers',
    apiPrefixes: ['/admin/users'],
  },
  {
    key: 'users.therapists',
    label: '技师',
    group: '用户',
    navHref: '/users/therapists',
    apiPrefixes: ['/admin/users'],
  },
  {
    key: 'therapists',
    label: '技师管控',
    group: '用户',
    navHref: '/therapists',
    apiPrefixes: ['/admin/therapists', '/admin/users/therapists'], // TODO: 确认 therapist profile 路由前缀
  },
  {
    key: 'verifications',
    label: '真人核验',
    group: '用户',
    navHref: '/verifications',
    apiPrefixes: ['/admin/therapists/verifications', '/admin/therapists/batch-verify'],
  },

  // ─── 业务 ──────────────────────────────────────────────────────────────────
  {
    key: 'orders',
    label: '订单',
    group: '业务',
    navHref: '/orders',
    apiPrefixes: ['/admin/orders'],
  },
  {
    key: 'matching-health',
    label: '派单监控',
    group: '业务',
    navHref: '/matching-health',
    apiPrefixes: ['/admin/matching-health'],
  },
  {
    key: 'reviews',
    label: '评价审核',
    group: '业务',
    navHref: '/reviews',
    apiPrefixes: ['/admin/reviews'],
  },
  {
    key: 'service-categories',
    label: '服务类型',
    group: '业务',
    navHref: '/service-categories',
    apiPrefixes: ['/admin/service-categories'], // TODO: 确认后端路由是否存在（前端页面独立）
  },
  {
    key: 'shows',
    label: '节目监控',
    group: '业务',
    navHref: '/shows',
    apiPrefixes: ['/admin/shows'],
  },

  // ─── AI 监管 ───────────────────────────────────────────────────────────────
  {
    key: 'ai.system',
    label: 'AI 规则',
    group: 'AI 监管',
    navHref: '/ai/system',
    apiPrefixes: ['/admin/ai-system'],
  },
  {
    key: 'ai.health',
    label: '健康仪表盘',
    group: 'AI 监管',
    navHref: '/ai/health',
    apiPrefixes: ['/admin/ai-system/health'], // TODO: 确认子路径
  },
  {
    key: 'ai.kill-switch',
    label: '紧急关停',
    group: 'AI 监管',
    navHref: '/ai/kill-switch',
    apiPrefixes: ['/admin/ai/kill-switch'],
  },
  {
    key: 'ai.assistant.sessions',
    label: '助理对话',
    group: 'AI 监管',
    navHref: '/ai/assistant/sessions',
    apiPrefixes: ['/admin/assistant/sessions'],
  },
  {
    key: 'ai.conversations',
    label: '对话审查',
    group: 'AI 监管',
    navHref: '/ai/conversations',
    apiPrefixes: ['/admin/ai/conversations'],
  },
  {
    key: 'ai.redline',
    label: '违禁监控',
    group: 'AI 监管',
    navHref: '/ai/redline',
    apiPrefixes: ['/admin/ai/redline'],
  },
  {
    key: 'ai.cost',
    label: '调用成本',
    group: 'AI 监管',
    navHref: '/ai/cost',
    apiPrefixes: ['/admin/ai/cost'],
  },
  {
    key: 'ai.messages',
    label: 'AI 代发记录',
    group: 'AI 监管',
    navHref: '/ai/messages',
    apiPrefixes: ['/admin/ai/messages'],
  },
  {
    key: 'ai.assistant-profiles',
    label: '用户画像',
    group: 'AI 监管',
    navHref: '/ai/assistant-profiles',
    apiPrefixes: ['/admin/ai/assistant-profiles'],
  },
  {
    key: 'ai.matching',
    label: '智能匹配',
    group: 'AI 监管',
    navHref: '/ai/matching',
    apiPrefixes: ['/admin/match'],
  },
  {
    key: 'voice',
    label: '声音复刻',
    group: 'AI 监管',
    navHref: '/voice',
    apiPrefixes: ['/admin/voice-clones'],
  },
  {
    key: 'prompts',
    label: 'Prompt 模板',
    group: 'AI 监管',
    navHref: '/prompts',
    apiPrefixes: ['/admin/prompts'],
  },

  // ─── 群发 ──────────────────────────────────────────────────────────────────
  {
    key: 'broadcasts',
    label: '群发记录',
    group: '群发',
    navHref: '/broadcasts',
    apiPrefixes: ['/admin/broadcasts'],
  },
  {
    key: 'broadcasts.new',
    label: '新建群发',
    group: '群发',
    navHref: '/broadcasts/new',
    apiPrefixes: ['/admin/broadcasts'],
  },

  // ─── 地理 ──────────────────────────────────────────────────────────────────
  {
    key: 'geo.dashboard',
    label: '地域总览',
    group: '地理',
    navHref: '/geo/dashboard',
    apiPrefixes: ['/admin/geo/dashboard', '/admin/analytics'], // TODO: 确认后端子路径
  },
  {
    key: 'geo.supply-demand',
    label: '供需缺口',
    group: '地理',
    navHref: '/geo/supply-demand',
    apiPrefixes: ['/admin/geo/supply-demand', '/admin/analytics'],
  },
  {
    key: 'geo.countries',
    label: '国家配置',
    group: '地理',
    navHref: '/geo/countries',
    apiPrefixes: ['/admin/geo/countries'],
  },
  {
    key: 'geo.cities',
    label: '城市维护',
    group: '地理',
    navHref: '/geo/cities',
    apiPrefixes: ['/admin/geo/cities'],
  },
  {
    key: 'geo.areas',
    label: '区域维护',
    group: '地理',
    navHref: '/geo/areas',
    apiPrefixes: ['/admin/geo/areas'],
  },

  // ─── 资金 ──────────────────────────────────────────────────────────────────
  {
    key: 'finance',
    label: '资金流水',
    group: '资金',
    navHref: '/finance',
    apiPrefixes: ['/admin/finance'],
  },
  {
    key: 'withdrawals',
    label: '提现审核',
    group: '资金',
    navHref: '/withdrawals',
    apiPrefixes: ['/admin/withdrawals'],
  },
  {
    key: 'agents',
    label: '代理商',
    group: '资金',
    navHref: '/agents',
    apiPrefixes: ['/admin/agents'],
  },
  {
    key: 'platform-accounts',
    label: '平台收款',
    group: '资金',
    navHref: '/platform-accounts',
    apiPrefixes: ['/admin/platform-accounts'],
  },
  {
    key: 'redeem',
    label: '积分回收',
    group: '资金',
    navHref: '/redeem',
    apiPrefixes: ['/admin/redeem'],
  },
  {
    key: 'purchases',
    label: '采购仲裁',
    group: '资金',
    navHref: '/purchases',
    apiPrefixes: ['/admin/purchases'], // TODO: 确认后端路由（前端购买仲裁页）
  },
  {
    key: 'currencies',
    label: '法币字典',
    group: '资金',
    navHref: '/currencies',
    apiPrefixes: ['/admin/currencies'],
  },
  {
    key: 'exchange-rates',
    label: '汇率维护',
    group: '资金',
    navHref: '/exchange-rates',
    apiPrefixes: ['/admin/exchange-rates'],
  },

  // ─── 风控 ──────────────────────────────────────────────────────────────────
  {
    key: 'audit',
    label: '审核工单',
    group: '风控',
    navHref: '/audit',
    apiPrefixes: ['/admin/audit'],
  },
  {
    key: 'risk',
    label: '风控事件',
    group: '风控',
    navHref: '/risk',
    apiPrefixes: ['/admin/risk'],
  },
  {
    key: 'disputes',
    label: '心动金仲裁',
    group: '风控',
    navHref: '/disputes',
    apiPrefixes: ['/admin/disputes'],
  },
  {
    key: 'system-errors',
    label: '系统报错与登录异常',
    group: '风控',
    navHref: '/system-errors',
    apiPrefixes: ['/admin/system-errors'],
  },
  {
    key: 'tickets',
    label: '用户投诉',
    group: '风控',
    navHref: '/tickets',
    apiPrefixes: ['/admin/tickets'],
  },

  // ─── 搜索 ──────────────────────────────────────────────────────────────────
  {
    key: 'search.analytics',
    label: '搜索分析',
    group: '搜索',
    navHref: '/search/analytics',
    apiPrefixes: ['/admin/search'],
  },
  {
    key: 'search.keywords',
    label: '热词运营',
    group: '搜索',
    navHref: '/search/keywords',
    apiPrefixes: ['/admin/search'],
  },
  {
    key: 'search.categories',
    label: '类目分布',
    group: '搜索',
    navHref: '/search/categories',
    apiPrefixes: ['/admin/search'],
  },

  // ─── 橱窗 ──────────────────────────────────────────────────────────────────
  {
    key: 'shop-items',
    label: '橱窗商品',
    group: '橱窗',
    navHref: '/shop-items',
    apiPrefixes: ['/admin/shop/items'], // TODO: 确认子路径
  },
  {
    key: 'shop-orders',
    label: '橱窗订单',
    group: '橱窗',
    navHref: '/shop-orders',
    apiPrefixes: ['/admin/shop/orders'], // TODO: 确认子路径
  },
  {
    key: 'shop-therapists',
    label: '技师经营',
    group: '橱窗',
    navHref: '/shop-therapists',
    apiPrefixes: ['/admin/shop/therapists'], // TODO: 确认子路径
  },

  // ─── 系统 ──────────────────────────────────────────────────────────────────
  {
    key: 'flags',
    label: '灰度开关',
    group: '系统',
    navHref: '/flags',
    apiPrefixes: ['/admin/flags'],
  },
  {
    key: 'integrations',
    label: '第三方服务',
    group: '系统',
    navHref: '/integrations',
    apiPrefixes: ['/admin/integrations'],
  },
  {
    key: 'mini-app',
    label: 'TG 小程序配置',
    group: '系统',
    navHref: '/mini-app',
    apiPrefixes: ['/admin/app-config'],
  },
  {
    key: 'roles',
    label: '账号角色',
    group: '系统',
    navHref: '/roles',
    apiPrefixes: ['/admin/roles', '/admin/permissions'],
  },
  {
    key: 'splash',
    label: '启动页配图',
    group: '系统',
    navHref: '/splash',
    apiPrefixes: ['/admin/splash'],
  },
  {
    key: 'audit-log',
    label: '操作日志',
    group: '系统',
    navHref: '/audit-log',
    apiPrefixes: ['/admin/audit-log'],
  },
];

/** 所有 permission key 集合（给 admin 超管全权用） */
export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

/**
 * 根据请求路径匹配对应权限（供 P3 网关用）。
 * 精确前缀匹配，取最长匹配。
 * 匹配不到返回 null（网关默认放行）。
 */
export function findPermissionByPath(path: string): Permission | null {
  let best: Permission | null = null;
  let bestLen = 0;
  for (const p of PERMISSIONS) {
    for (const prefix of p.apiPrefixes) {
      if (path.startsWith(prefix) && prefix.length > bestLen) {
        best = p;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}
