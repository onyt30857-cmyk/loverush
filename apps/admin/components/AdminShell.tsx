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
// 一级组图标 + 二级/三级菜单项与子类图标,统一 Feather/Lucide 线条语言
type IconName =
  // 一级组
  | 'home' | 'users' | 'clipboard' | 'ai' | 'megaphone'
  | 'globe' | 'wallet' | 'shield' | 'search' | 'bag' | 'sliders'
  // 二级/三级 叶子项与子类
  | 'gauge' | 'user' | 'sparkles' | 'shieldCheck' | 'idCard'
  | 'receipt' | 'pulse' | 'star' | 'tag' | 'play'
  | 'bookOpen' | 'fileText' | 'terminal' | 'mic'
  | 'radio' | 'heart' | 'circleDollar' | 'send'
  | 'eye' | 'chat' | 'chatDots' | 'ban'
  | 'link' | 'userCircle' | 'alertOctagon' | 'power'
  | 'list' | 'plusCircle'
  | 'map' | 'scale' | 'flag' | 'building' | 'pin'
  | 'banknote' | 'trendingUp' | 'arrowDownToLine' | 'landmark'
  | 'usersTwo' | 'briefcase' | 'recycle' | 'cart'
  | 'percent' | 'coins' | 'arrowRightLeft'
  | 'clipboardCheck' | 'alertTriangle' | 'gavel' | 'bug' | 'ticket'
  | 'chartBar' | 'hash' | 'pieChart'
  | 'box' | 'packageCheck' | 'store'
  | 'settings' | 'toggleRight' | 'plug' | 'smartphone' | 'image'
  | 'lock' | 'key' | 'history';

/** 导航项(叶节点) */
type NavItem = { href: string; label: string; icon: IconName };
/** 三级子类(中间层,可折叠) */
type NavSection = { label: string; icon: IconName; items: NavItem[] };
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
    items: [{ href: '/dashboard', label: '经营总览', icon: 'gauge' }],
  },
  {
    label: '用户',
    icon: 'users',
    items: [
      { href: '/users/customers', label: '客户', icon: 'user' },
      { href: '/users/therapists', label: '技师', icon: 'sparkles' },
      { href: '/therapists', label: '技师管控', icon: 'shieldCheck' },
      { href: '/verifications', label: '真人核验', icon: 'idCard' },
    ],
  },
  {
    label: '业务',
    icon: 'clipboard',
    items: [
      { href: '/orders', label: '订单', icon: 'receipt' },
      { href: '/matching-health', label: '派单监控', icon: 'pulse' },
      { href: '/reviews', label: '评价审核', icon: 'star' },
      { href: '/service-categories', label: '服务类型', icon: 'tag' },
      { href: '/shows', label: '节目监控', icon: 'play' },
    ],
  },
  {
    label: 'AI 监管',
    icon: 'ai',
    sections: [
      {
        label: '规则与配置',
        icon: 'bookOpen',
        items: [
          { href: '/ai/system', label: 'AI 规则', icon: 'fileText' },
          { href: '/prompts', label: 'Prompt 模板', icon: 'terminal' },
          { href: '/voice', label: '声音复刻', icon: 'mic' },
        ],
      },
      {
        label: '运行监控',
        icon: 'radio',
        items: [
          { href: '/ai/health', label: '健康仪表盘', icon: 'heart' },
          { href: '/ai/cost', label: '调用成本', icon: 'circleDollar' },
          { href: '/ai/messages', label: 'AI 代发记录', icon: 'send' },
        ],
      },
      {
        label: '内容审查',
        icon: 'eye',
        items: [
          { href: '/ai/conversations', label: '对话审查', icon: 'chat' },
          { href: '/ai/assistant/sessions', label: '助理对话', icon: 'chatDots' },
          { href: '/ai/redline', label: '违禁监控', icon: 'ban' },
        ],
      },
      {
        label: '智能与画像',
        icon: 'sparkles',
        items: [
          { href: '/ai/matching', label: '智能匹配', icon: 'link' },
          { href: '/ai/assistant-profiles', label: '用户画像', icon: 'userCircle' },
        ],
      },
      {
        label: '应急管控',
        icon: 'alertOctagon',
        items: [
          { href: '/ai/kill-switch', label: '紧急关停', icon: 'power' },
        ],
      },
    ],
  },
  {
    label: '群发',
    icon: 'megaphone',
    items: [
      { href: '/broadcasts', label: '群发记录', icon: 'list' },
      { href: '/broadcasts/new', label: '新建群发', icon: 'plusCircle' },
    ],
  },
  {
    label: '地理',
    icon: 'globe',
    items: [
      { href: '/geo/dashboard', label: '地域总览', icon: 'map' },
      { href: '/geo/supply-demand', label: '供需缺口', icon: 'scale' },
      { href: '/geo/countries', label: '国家配置', icon: 'flag' },
      { href: '/geo/cities', label: '城市维护', icon: 'building' },
      { href: '/geo/areas', label: '区域维护', icon: 'pin' },
    ],
  },
  {
    label: '资金',
    icon: 'wallet',
    sections: [
      {
        label: '资金流转',
        icon: 'banknote',
        items: [
          { href: '/finance', label: '资金流水', icon: 'trendingUp' },
          { href: '/withdrawals', label: '提现审核', icon: 'arrowDownToLine' },
          { href: '/platform-accounts', label: '平台收款', icon: 'landmark' },
        ],
      },
      {
        label: '代理与积分',
        icon: 'usersTwo',
        items: [
          { href: '/agents', label: '代理商', icon: 'briefcase' },
          { href: '/redeem', label: '积分回收', icon: 'recycle' },
          { href: '/purchases', label: '采购仲裁', icon: 'cart' },
        ],
      },
      {
        label: '币种汇率',
        icon: 'percent',
        items: [
          { href: '/currencies', label: '法币字典', icon: 'coins' },
          { href: '/exchange-rates', label: '汇率维护', icon: 'arrowRightLeft' },
        ],
      },
    ],
  },
  {
    label: '风控',
    icon: 'shield',
    items: [
      { href: '/audit', label: '审核工单', icon: 'clipboardCheck' },
      { href: '/risk', label: '风控事件', icon: 'alertTriangle' },
      { href: '/disputes', label: '心动金仲裁', icon: 'gavel' },
      { href: '/system-errors', label: '系统报错与登录异常', icon: 'bug' },
      { href: '/tickets', label: '用户投诉', icon: 'ticket' },
    ],
  },
  {
    label: '搜索',
    icon: 'search',
    items: [
      { href: '/search/analytics', label: '搜索分析', icon: 'chartBar' },
      { href: '/search/keywords', label: '热词运营', icon: 'hash' },
      { href: '/search/categories', label: '类目分布', icon: 'pieChart' },
    ],
  },
  {
    label: '橱窗',
    icon: 'bag',
    items: [
      { href: '/shop-items', label: '橱窗商品', icon: 'box' },
      { href: '/shop-orders', label: '橱窗订单', icon: 'packageCheck' },
      { href: '/shop-therapists', label: '技师经营', icon: 'store' },
    ],
  },
  {
    label: '系统',
    icon: 'sliders',
    sections: [
      {
        label: '配置与开关',
        icon: 'settings',
        items: [
          { href: '/flags', label: '灰度开关', icon: 'toggleRight' },
          { href: '/integrations', label: '第三方服务', icon: 'plug' },
          { href: '/mini-app', label: 'TG 小程序配置', icon: 'smartphone' },
          { href: '/splash', label: '启动页配图', icon: 'image' },
        ],
      },
      {
        label: '权限与审计',
        icon: 'lock',
        items: [
          { href: '/roles', label: '账号角色', icon: 'key' },
          { href: '/audit-log', label: '操作日志', icon: 'history' },
        ],
      },
    ],
  },
];

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  // ── 一级组 ──
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

  // ── 二级/三级 叶子项与子类 ──
  gauge: (
    <>
      <path d="M4.2 17a8.5 8.5 0 1 1 15.6 0" />
      <path d="M12 13l3.5-3.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11.5 4.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5 1.5-4z" />
      <path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 3.5l7 2.5v5.2c0 3.9-2.8 6.8-7 8.6-4.2-1.8-7-4.7-7-8.6V6l7-2.5z" />
      <path d="m9 11.5 2 2 4-4" />
    </>
  ),
  idCard: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16a3 3 0 0 1 6 0" />
      <path d="M14.5 10.5h4M14.5 13.5h4" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3.5h14v17l-2.3-1.4-2.4 1.4-2.3-1.4-2.4 1.4-2.3-1.4L5 20.5z" />
      <path d="M8.5 8h7M8.5 12h7" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 4 13 2.5-7H21" />,
  star: <path d="M12 4.5l2.2 4.6 5 .6-3.7 3.4 1 4.9L12 16.1 7.5 18.5l1-4.9L4.8 9.7l5-.6L12 4.5z" />,
  tag: (
    <>
      <path d="M4 4.5h7.5L20 13l-7 7-8.5-8.5V4.5z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M10 8.5l5 3.5-5 3.5z" />
    </>
  ),
  bookOpen: (
    <>
      <path d="M12 6.5C10 5 7 4.5 4.5 5v12c2.5-.5 5.5 0 7.5 1.5 2-1.5 5-2 7.5-1.5V5C17 4.5 14 5 12 6.5z" />
      <path d="M12 6.5v12" />
    </>
  ),
  fileText: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 12h6M9 15.5h6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="m7.5 10 2.5 2-2.5 2" />
      <path d="M12.5 15h4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v2.5" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M5 5a9.5 9.5 0 0 0 0 14M19 19a9.5 9.5 0 0 0 0-14" />
    </>
  ),
  heart: <path d="M12 20S4 15 4 9.5A4 4 0 0 1 12 7a4 4 0 0 1 8 2.5C20 15 12 20 12 20z" />,
  circleDollar: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M14.5 9c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.9-2.5 2s1 1.7 2.5 2 2.5 1 2.5 2.2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5" />
      <path d="M12 6v1.5M12 16.5V18" />
    </>
  ),
  send: (
    <>
      <path d="M21 4 3 11l6.5 2.5L12 20l3-6.5L21 4z" />
      <path d="m9.5 13.5 2.5-2.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  chat: (
    <>
      <path d="M5 5h14v10H9l-4 3.5V5z" />
      <path d="M8.5 9h7M8.5 12h4" />
    </>
  ),
  chatDots: (
    <>
      <path d="M5 5h14v10H9l-4 3.5V5z" />
      <circle cx="9" cy="10" r=".9" />
      <circle cx="12" cy="10" r=".9" />
      <circle cx="15" cy="10" r=".9" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <path d="m6.5 6.5 11 11" />
    </>
  ),
  link: (
    <>
      <path d="M9 14.5 14.5 9" />
      <path d="M11 6.5l1.2-1.2a3.5 3.5 0 0 1 5 5L16 11.5" />
      <path d="M13 17.5l-1.2 1.2a3.5 3.5 0 0 1-5-5L8 12.5" />
    </>
  ),
  userCircle: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <circle cx="12" cy="10" r="2.8" />
      <path d="M6.8 18a5.4 5.4 0 0 1 10.4 0" />
    </>
  ),
  alertOctagon: (
    <>
      <path d="M8.3 3.5h7.4L20.5 8.3v7.4L15.7 20.5H8.3L3.5 15.7V8.3L8.3 3.5z" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </>
  ),
  power: (
    <>
      <path d="M12 4v7" />
      <path d="M7 6.5a8 8 0 1 0 10 0" />
    </>
  ),
  list: (
    <>
      <path d="M8 6.5h12M8 12h12M8 17.5h12" />
      <circle cx="4.2" cy="6.5" r="1.1" />
      <circle cx="4.2" cy="12" r="1.1" />
      <circle cx="4.2" cy="17.5" r="1.1" />
    </>
  ),
  plusCircle: (
    <>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  map: (
    <>
      <path d="m3.5 6 5.5-2 6 2 5.5-2v14l-5.5 2-6-2-5.5 2V6z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M7 20h10" />
      <path d="M5 7.5 12 6l7 1.5" />
      <path d="M5 7.5 2.8 13a2.2 2.2 0 0 0 4.4 0L5 7.5z" />
      <path d="M19 7.5 16.8 13a2.2 2.2 0 0 0 4.4 0L19 7.5z" />
    </>
  ),
  flag: (
    <>
      <path d="M5 3.5v17" />
      <path d="M5 4.5h11l-2 3 2 3H5" />
    </>
  ),
  building: (
    <>
      <rect x="5.5" y="3.5" width="13" height="17" rx="1.5" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2" />
      <path d="M10.5 20.5v-3h3v3" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6-5.3 6-10a6 6 0 0 0-12 0c0 4.7 6 10 6 10z" />
      <circle cx="12" cy="11" r="2.3" />
    </>
  ),
  banknote: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6.5 10v4M17.5 10v4" />
    </>
  ),
  trendingUp: (
    <>
      <path d="M3.5 16.5 9 11l3.5 3.5L20 7" />
      <path d="M15.5 7H20v4.5" />
    </>
  ),
  arrowDownToLine: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10.5 4 4 4-4" />
      <path d="M5.5 19h13" />
    </>
  ),
  landmark: (
    <>
      <path d="M3.5 9 12 4l8.5 5" />
      <path d="M5 9v8M9 9v8M15 9v8M19 9v8" />
      <path d="M3.5 20.5h17" />
    </>
  ),
  usersTwo: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M16.5 14.2A5.5 5.5 0 0 1 20.5 19" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="11" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M3.5 12h17" />
    </>
  ),
  recycle: (
    <>
      <path d="M4.5 9A8 8 0 0 1 18 6.5l2 2" />
      <path d="M20 4.5v4h-4" />
      <path d="M19.5 15A8 8 0 0 1 6 17.5l-2-2" />
      <path d="M4 19.5v-4h4" />
    </>
  ),
  cart: (
    <>
      <circle cx="9.5" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
      <path d="M3 4h2l2.2 11h10l2-7.5H6" />
    </>
  ),
  percent: (
    <>
      <path d="m5 19 14-14" />
      <circle cx="8" cy="8" r="2" />
      <circle cx="16" cy="16" r="2" />
    </>
  ),
  coins: (
    <>
      <circle cx="8.5" cy="8.5" r="4.8" />
      <path d="M12.2 5.2a4.8 4.8 0 1 1-1.4 9.3" />
    </>
  ),
  arrowRightLeft: (
    <>
      <path d="M7 8h11" />
      <path d="m15 5 3 3-3 3" />
      <path d="M17 16H6" />
      <path d="m9 13-3 3 3 3" />
    </>
  ),
  clipboardCheck: (
    <>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5v1H9z" />
      <path d="m9.5 13 2 2 3.5-3.5" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M12 4 2.5 20h19L12 4z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </>
  ),
  gavel: (
    <>
      <path d="m13.4 5.8 4.8 4.8-2.1 2.1-4.8-4.8z" />
      <path d="m11.3 7.9-6 6 2.1 2.1 6-6" />
      <path d="M5 20.5h7" />
    </>
  ),
  bug: (
    <>
      <rect x="7.5" y="8" width="9" height="10" rx="4.5" />
      <path d="M9.5 8a2.5 2.5 0 0 1 5 0" />
      <path d="M4 11h3M4 16h3.5M17 11h3M16.5 16H20M12 8v10" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.2a1.8 1.8 0 0 0 0 3.6V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.2a1.8 1.8 0 0 0 0-3.6V8z" />
      <path d="M14 6v12" />
    </>
  ),
  chartBar: (
    <>
      <path d="M4 4v16.5h16.5" />
      <rect x="7" y="12" width="3" height="5" />
      <rect x="12" y="8.5" width="3" height="8.5" />
      <rect x="17" y="14" width="3" height="3" />
    </>
  ),
  hash: <path d="M9 4 7.5 20M16.5 4 15 20M4.5 9h15.5M4 15h15.5" />,
  pieChart: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
      <path d="M12 3.5v8.5h8.5A8.5 8.5 0 0 0 12 3.5z" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  packageCheck: (
    <>
      <path d="M20.5 11V7.5L12 3 3.5 7.5v9L12 21l3-1.6" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="m15.5 18.5 2 2 4-4" />
    </>
  ),
  store: (
    <>
      <path d="M4 9.5 5.5 5h13L20 9.5" />
      <path d="M4 9.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M5 11v8.5h14V11" />
      <path d="M9.5 19.5v-5h5v5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.2 7l2.2 1.3M17.6 15.7 19.8 17M4.2 17l2.2-1.3M17.6 8.3 19.8 7M3 12h2.5M18.5 12H21" />
    </>
  ),
  toggleRight: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <circle cx="16" cy="12" r="2.4" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0V8z" />
      <path d="M12 16v5" />
    </>
  ),
  smartphone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m5.5 17 4-4 3 3 3-3.5 3 4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15" r="1.3" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="8.5" r="4" />
      <path d="m11.5 11.5 7 7" />
      <path d="m15.5 15.5 1.8-1.8M18 18l1.8-1.8" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 1 2.5 6" />
      <path d="M3.5 18v-4h4" />
      <path d="M12 8v4l3 1.8" />
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

// ── 侧边栏字号规范(统一标准,改字号只动这里)──
//   一级分组          15px / font-medium   · 图标 18px
//   菜单项(二级/三级) 14px(可点目的页一律同字号,深度只用缩进表达)· 图标 16px
//   子类标题          13px / font-medium   · 图标 15px(分组小标题,非目的页)

/** 两级导航项列表(组展开后的扁平项)· 菜单项 14px / 图标 16px */
function NavItemList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <div className="mb-1 mt-0.5 space-y-px">
      {items.map((it) => {
        const active = pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-2.5 rounded-lg py-2 pl-[22px] pr-3 text-[14px] transition-colors ${
              active
                ? 'bg-primary/[0.06] font-medium text-primary'
                : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
            }`}
          >
            <NavIcon
              name={it.icon}
              className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-ink-300'}`}
            />
            <span className="truncate">{it.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** 三级子类折叠块(第二层)· 子类标题带 14px 图标,子项带 13px 图标 */
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
      {/* 子类标题:介于组和项之间,比组小/淡,带小图标,缩进到组图标右侧 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md py-[6px] pl-[22px] pr-2.5 text-[13px] font-medium tracking-wide text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
      >
        <NavIcon name={section.icon} className="h-[15px] w-[15px] shrink-0 text-ink-300" />
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
                className={`flex items-center gap-2 rounded-lg py-2 pl-[40px] pr-3 text-[14px] transition-colors ${
                  active
                    ? 'bg-primary/[0.06] font-medium text-primary'
                    : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
                }`}
              >
                <NavIcon
                  name={it.icon}
                  className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-ink-300'}`}
                />
                <span className="truncate">{it.label}</span>
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
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[15px] font-medium transition-colors ${
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
