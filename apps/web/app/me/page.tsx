'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Avatar, GhostButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';

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

  // 兜底：dash 永远不为 null 时也能渲染；首屏 dash=null 显占位 ‘—’，数据到了覆盖
  const points = dash?.points?.balance ? parseInt(dash.points.balance, 10) : null;
  const totalSpent = dash?.orders?.total_spent_points
    ? parseInt(dash.orders.total_spent_points, 10)
    : null;
  const orderCount = dash?.orders?.total_orders;
  const favCount = dash?.relationships?.favorite_count;
  const rewardPts = dash?.invite_reward?.invite_reward_points
    ? parseInt(dash.invite_reward.invite_reward_points, 10).toLocaleString()
    : null;

  const menu = [
    ...(roles.includes('agent') ? [{ href: '/agent', label: '服务商控制台', icon: '🪙' }] : []),
    { href: '/me/preferences', label: '我的偏好', icon: '💝' },
    { href: '/me/assistant-memory', label: '我的助理记忆', icon: '🧠' },
    { href: '/me/notifications', label: '消息通知', icon: '🔔' },
    { href: '/me/privacy', label: '隐私模式', icon: '🔒' },
    { href: '/me/invites', label: '邀请好友', icon: '🎁' },
    { href: '/me/orders', label: '我的订单', icon: '📦' },
  ];

  return (
    <AppShell>
      {/* 用户 hero · 渐变背景（立即显，不等数据） */}
      <div className="bg-gradient-soft px-5 pb-5 pt-5">
        <div className="flex items-center gap-4">
          <Avatar size={72} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-serif-cn text-xl font-bold text-ink-800">
              {user?.displayName ?? '匿名用户'}
            </div>
            <div className="label-cormorant mt-1 text-[10px]">
              ID · {user?.id.slice(0, 12) ?? '——'}…
            </div>
          </div>
        </div>

        {/* 积分大卡（渐变） · balance 未到时显 ‘—’ */}
        <div className="mt-5 overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">POINTS BALANCE</div>
          <div className="mt-1 flex items-end gap-2">
            <div className="text-display text-4xl font-bold num">
              {points == null ? '—' : points.toLocaleString()}
            </div>
            <div className="pb-1 text-xs text-white/80">积分</div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[11px]">
            <span className="text-white/80">
              累计消费{' '}
              <span className="text-display font-bold text-white num">
                {totalSpent == null ? '—' : totalSpent.toLocaleString()}
              </span>
            </span>
            <Link
              href="/me/recharge"
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur transition active:scale-95"
            >
              买积分 →
            </Link>
          </div>
        </div>

        {/* 三栏统计 · 未到时数字占位 ‘—’ */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="ORDERS" zh="订单" value={orderCount ?? '—'} />
          <Stat label="FAVORITES" zh="收藏" value={favCount ?? '—'} />
          <Stat label="REWARDS" zh="邀请奖励" value={rewardPts ?? '—'} />
        </div>
      </div>

      {/* 菜单列表 · 进页立显 */}
      <ul className="mt-3 divide-y divide-warm-50 border-y border-warm-100 bg-white">
        {menu.map((m, i) => (
          <li key={m.href} className="animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
            <Link
              href={m.href}
              className="flex items-center gap-3 px-5 py-3.5 transition active:bg-warm-50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warm-50 text-base">
                {m.icon}
              </span>
              <span className="flex-1 text-[14px] text-ink-800">{m.label}</span>
              <span className="text-lg text-ink-300">›</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="px-5 py-6">
        <GhostButton onClick={logout}>退出登录</GhostButton>
      </div>
    </AppShell>
  );
}

function Stat({ label, zh, value }: { label: string; zh: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-warm-100 bg-white py-3 text-center shadow-warm-xs">
      <div className="text-display text-lg font-bold text-ink-800 num">{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-600">{zh}</div>
      <div className="label-cormorant mt-0.5 text-[8.5px]">{label}</div>
    </div>
  );
}
