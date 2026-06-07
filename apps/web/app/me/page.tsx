'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageContainer } from '@/components/PageContainer';
import { Avatar, GhostButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';

interface Dashboard {
  orders?: { total_orders: number; total_spent_points: string };
  points?: { balance: string; total_in: string; total_out: string };
  tips_given?: { tip_count: number };
  relationships?: { favorite_count: number };
  invite_reward?: { invite_reward_points: string };
}

// C1 修复 · §0/§4：进页即可见，dash 不阻塞整页渲染。
// hero / 头像 / 菜单这些不依赖 dash 的元素先到先显；
// 三栏 stat 与积分余额未到时显占位 —，到了无声替换。
export default function MePage() {
  const { user, logout } = useAuth();
  // SWR · 二次进站 0ms 显旧 dash · 失败降级 {}(不阻塞页面,跟旧行为一致)
  const { data: dashData, error: dashErr } = useSWR<Dashboard>('/dashboard/customer/me');
  const dash: Dashboard | null = dashErr ? {} : dashData ?? null;
  // 角色单独 key · 失败为空数组(不显运营入口)
  const { data: rolesData } = useSWR<string[]>('/me/roles');
  const roles: string[] = rolesData ?? [];

  // 0028 客户法币 · /currencies 字典(SWR 自动 cache)
  const { data: currencies } = useSWR<CurrencyMini[]>('/currencies');
  const userCurrency = user?.defaultCurrencyCode ?? null;

  // 兜底：dash 永远不为 null 时也能渲染；首屏 dash=null 显占位 ‘—’，数据到了覆盖
  const points = dash?.points?.balance ? parseInt(dash.points.balance, 10) : null;
  const totalSpent = dash?.orders?.total_spent_points
    ? parseInt(dash.orders.total_spent_points, 10)
    : null;
  // 转换显示字符串
  const balanceLabel = points == null
    ? '—'
    : userCurrency && currencies
      ? pointsToFiatLabel(points, userCurrency, currencies)
      : points.toLocaleString();
  const totalSpentLabel = totalSpent == null
    ? '—'
    : userCurrency && currencies
      ? pointsToFiatLabel(totalSpent, userCurrency, currencies)
      : totalSpent.toLocaleString();
  const orderCount = dash?.orders?.total_orders;
  const favCount = dash?.relationships?.favorite_count;
  const rewardPts = dash?.invite_reward?.invite_reward_points
    ? parseInt(dash.invite_reward.invite_reward_points, 10).toLocaleString()
    : null;

  // 去重:「我的订单/我的收藏/邀请好友」已在上方三栏统计(带数量、可点),不再重复列。
  // 分组卡片式:服务商(仅代理) / 我的 / 设置 —— 更高级大气简约。
  const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string; icon: string }> }> = [
    ...(roles.includes('agent')
      ? [{ title: '服务商', items: [{ href: '/agent', label: '服务商控制台', icon: '🪙' }] }]
      : []),
    {
      title: '我的',
      items: [
        { href: '/me/footprint', label: '我的足迹', icon: '📅' },
        { href: '/me/preferences', label: '我的偏好', icon: '💝' },
        { href: '/me/assistant-memory', label: '我的助理记忆', icon: '🧠' },
      ],
    },
    {
      title: '设置',
      items: [
        { href: '/me/notifications', label: '消息通知', icon: '🔔' },
        { href: '/me/notification-settings', label: '通知设置', icon: '⚙️' },
        { href: '/me/privacy', label: '隐私模式', icon: '🔒' },
      ],
    },
  ];

  return (
    <AppShell>
      {/* 用户 hero · 渐变背景(立即显,不等数据) · 整块点击进编辑页 */}
      <PageContainer variant="default" className="bg-gradient-soft">
        <Link href="/me/profile" className="block transition active:opacity-80" aria-label="编辑个人资料">
          <div className="flex items-center gap-4">
            <Avatar size={72} src={user?.avatarUrl ?? undefined} fallback={user?.displayName?.slice(0, 1) ?? '🙂'} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-serif-cn text-xl font-bold text-ink-800">
                  {user?.displayName ?? '匿名用户'}
                </div>
                <span className="text-[11px] text-ink-400" aria-hidden>✎</span>
              </div>
              <div className="label-cormorant mt-1 text-[10px]">
                ID · {user?.id.slice(0, 12) ?? '——'}…
              </div>
            </div>
            <span className="text-lg text-ink-300" aria-hidden>›</span>
          </div>
        </Link>

        {/* 余额大卡(渐变) · 0028 按客户法币显 · userCurrency 无值兜底积分 · 点上半区进钱包账单 */}
        <div className="mt-5 overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <Link href="/me/wallet" className="block transition active:opacity-80" aria-label="查看钱包账单">
            <div className="flex items-center justify-between">
              <div className="label-cormorant text-[10px] text-white/80">BALANCE</div>
              <span className="text-[11px] text-white/80">账单明细 ›</span>
            </div>
            <div className="mt-1 flex items-end gap-2">
              <div className="text-display text-4xl font-bold num">{balanceLabel}</div>
            </div>
          </Link>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[11px]">
            <span className="text-white/80">
              累计消费{' '}
              <span className="text-display font-bold text-white num">{totalSpentLabel}</span>
            </span>
            <Link
              href="/me/recharge"
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur transition active:scale-95"
            >
              充值 →
            </Link>
          </div>
        </div>

        {/* 三栏统计 · 可点击进对应页 · 未到时数字占位 '—' */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat href="/order" label="ORDERS" zh="订单" value={orderCount ?? '—'} />
          <Stat href="/me/favorites" label="FAVORITES" zh="收藏" value={favCount ?? '—'} />
          <Stat href="/me/invites" label="REWARDS" zh="邀请奖励" value={rewardPts ?? '—'} />
        </div>
      </PageContainer>

      {/* 功能分组 · 卡片式(留白 + 精简) */}
      <div className="mt-4 space-y-6">
        {SECTIONS.map((sec, gi) => (
          <section key={sec.title} className="px-4 animate-fade-up" style={{ animationDelay: `${gi * 50}ms` }}>
            <div className="mb-2 px-1.5 text-[11px] font-medium tracking-[0.12em] text-ink-400">{sec.title}</div>
            <div className="overflow-hidden rounded-2xl bg-white shadow-warm-xs divide-y divide-warm-50">
              {sec.items.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  className="flex items-center gap-3.5 px-4 py-4 transition active:bg-warm-50/60"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warm-50 text-[17px]">
                    {m.icon}
                  </span>
                  <span className="flex-1 text-[14.5px] text-ink-800">{m.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <PageContainer variant="default">
        <GhostButton onClick={logout}>退出登录</GhostButton>
      </PageContainer>
    </AppShell>
  );
}

function Stat({
  label,
  zh,
  value,
  href,
}: {
  label: string;
  zh: string;
  value: number | string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-display text-lg font-bold text-ink-800 num">{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-600">{zh}</div>
      <div className="label-cormorant mt-0.5 text-[8.5px]">{label}</div>
    </>
  );
  const className = 'block rounded-2xl border border-warm-100 bg-white py-3 text-center shadow-warm-xs transition active:scale-[0.97] active:bg-warm-50';
  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}
