'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Compass, MessageCircle, Calendar, User, Sparkles, LayoutGrid, ClipboardList } from 'lucide-react';
import useSWR, { mutate } from 'swr';
import { apiGet } from '@/lib/api';
import { VoiceAssistantSheet } from './VoiceAssistantSheet';

// 底部导航配置 · 后台 app_config(nav.customer / nav.therapist)可改 label/显隐/顺序
// 缺配置/接口失败 → 回退代码默认(永不假装数据)。图标/路由/中央按钮行为始终在代码定义。
interface NavTabCfg { key: string; label?: string; enabled?: boolean; order?: number }
function useNavTabs(scope: 'customer' | 'therapist'): Record<string, NavTabCfg> {
  const { data } = useSWR<Record<string, unknown>>('/app-config');
  const tabs = (data?.[`nav.${scope}`] as { tabs?: NavTabCfg[] } | undefined)?.tabs ?? [];
  const map: Record<string, NavTabCfg> = {};
  for (const t of tabs) if (t?.key) map[t.key] = t;
  return map;
}
/** 按配置 order 排序一组带 key 的描述(缺 order 用默认索引);过滤 enabled!==false */
function orderTabs<T extends { key: string }>(items: T[], cfg: Record<string, NavTabCfg>): T[] {
  return items
    .filter((it) => cfg[it.key]?.enabled !== false)
    .map((it, i) => ({ it, ord: cfg[it.key]?.order ?? i }))
    .sort((a, b) => a.ord - b.ord)
    .map((x) => x.it);
}

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

/**
 * 私聊未读消息总数 · 客户/技师双端共用。
 * 复用会话列表同一 SWR key('/conversations')→ 会话页 SSE 新消息 mutate 时角标自动刷新;
 * 跨页(home/订单等)由 SWR revalidateOnFocus + 60s 兜底刷新保持新鲜。
 * sum(unreadCount) = 未读「消息条数」(非有未读的会话数)。
 * ⚠️ 历史 bug:旧代码读 c.messageCount(后端实际字段是 unreadCount)→ 恒 undefined → 角标永远不显。
 */
function useChatUnreadTotal(): number {
  const { data } = useSWR<Array<{ unreadCount?: number }>>('/conversations', { refreshInterval: 60000 });
  return (data ?? []).reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
}

type CustomerKey = 'discover' | 'messages' | 'assistant' | 'orders' | 'me';
type TherapistKey = 'home' | 'orders' | 'schedule' | 'alter' | 'messages' | 'me';

// 客户端底部 5 tab · v5 (2026-06-02 [[loverush_m03_audit_2026_06_01]] v5 spec):
// 中央"助理"按钮不再跳 /assistant 路由 · 改成弹 VoiceAssistantSheet (纯语音入口)
// active='assistant' 仍接受 (兼容老页面调用 · 只是不再有路由匹配)
export function CustomerBottomNav({ active }: { active: CustomerKey }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const nav = useNavTabs('customer');
  const chatUnread = useChatUnreadTotal();
  const lbl = (k: string, d: string) => nav[k]?.label || d;
  // 中央"助理"按钮 onClick 弹 sheet(不跳页);其余侧 tab 跳页;私聊带未读角标
  const tabs = orderTabs([
    { key: 'discover', node: <SideTab key="discover" icon={Compass} label={lbl('discover', '发现')} href="/home" active={active === 'discover'} /> },
    { key: 'messages', node: <SideTab key="messages" icon={MessageCircle} label={lbl('messages', '私聊')} href="/conversations" active={active === 'messages'} badge={chatUnread} /> },
    { key: 'assistant', node: <CenterTab key="assistant" onClick={() => setSheetOpen(true)} label={lbl('assistant', '助理')} active={active === 'assistant' || sheetOpen} /> },
    { key: 'orders', node: <SideTab key="orders" icon={Calendar} label={lbl('orders', '预约')} href="/order" active={active === 'orders'} /> },
    { key: 'me', node: <SideTab key="me" icon={User} label={lbl('me', '我的')} href="/me" active={active === 'me'} /> },
  ], nav);
  return (
    <>
      <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
        <div className="relative grid items-end px-3 pb-2 pt-3" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
          {tabs.map((t) => t.node)}
        </div>
      </nav>
      <VoiceAssistantSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

// 技师端底部 5 tab · 中央为 AI 分身(技师差异化核心)，私聊带未读角标
export function TherapistBottomNav({ active }: { active: TherapistKey }) {
  const unread = useChatUnreadTotal();
  const nav = useNavTabs('therapist');
  const lbl = (k: string, d: string) => nav[k]?.label || d;
  // 中央"排班"大按钮跳页(技师高频);其余侧 tab。私聊带未读角标。
  const tabs = orderTabs([
    { key: 'home', node: <SideTab key="home" icon={LayoutGrid} label={lbl('home', '工作台')} href="/t/home" active={active === 'home'} /> },
    { key: 'orders', node: <SideTab key="orders" icon={ClipboardList} label={lbl('orders', '订单')} href="/t/orders" active={active === 'orders'} /> },
    { key: 'schedule', node: <CenterTab key="schedule" href="/t/schedule" label={lbl('schedule', '排班')} active={active === 'schedule'} icon={Calendar} /> },
    { key: 'messages', node: <SideTab key="messages" icon={MessageCircle} label={lbl('messages', '私聊')} href="/t/messages" active={active === 'messages'} badge={unread} /> },
    { key: 'me', node: <SideTab key="me" icon={User} label={lbl('me', '我的')} href="/t/me" active={active === 'me'} /> },
  ], nav);
  return (
    <nav className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 backdrop-blur-md">
      <div className="relative grid items-end px-3 pb-2 pt-3" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
        {tabs.map((t) => t.node)}
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
/**
 * 中央大圆按钮 · 支持 href (技师端排班跳页) 或 onClick (客户端弹 sheet)
 * 任一传入即可 · 两个都给则优先 onClick
 */
function CenterTab({
  href, onClick, label, active, icon: Icon = Sparkles,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  active?: boolean;
  icon?: typeof Sparkles;
}) {
  const className = "-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-cta shadow-rose-lg ring-4 ring-white transition active:scale-95";
  return (
    <div className="flex flex-col items-center">
      {onClick ? (
        <button type="button" onClick={onClick} className={className} aria-label={label}>
          <Icon className="h-6 w-6 text-white" />
        </button>
      ) : href ? (
        <Link href={href} className={className} aria-label={label}>
          <Icon className="h-6 w-6 text-white" />
        </Link>
      ) : null}
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
