'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Avatar, GhostButton, LoadingFull } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';

interface Dashboard {
  orders?: { total_orders: number; total_spent_points: string };
  points?: { balance: string; total_in: string; total_out: string };
  tips_given?: { tip_count: number };
  relationships?: { favorite_count: number };
  invite_reward?: { invite_reward_points: string };
}

export default function MePage() {
  const { user, logout } = useAuth();
  const [dash, setDash] = useState<Dashboard | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<Dashboard>('/dashboard/customer/me');
        setDash(data);
      } catch {
        setDash({}); // 失败/401 也退出 loading，显示空数据而非永久白屏
      }
    })();
  }, []);

  if (!dash) return <AppShell title="我的"><LoadingFull /></AppShell>;

  const menu = [
    { href: '/me/preferences', label: '我的偏好', icon: '💝' },
    { href: '/me/notifications', label: '消息通知', icon: '🔔' },
    { href: '/me/privacy', label: '隐私模式', icon: '🔒' },
    { href: '/me/invites', label: '邀请好友', icon: '🎁' },
    { href: '/me/orders', label: '我的订单', icon: '📦' },
  ];

  const points = parseInt(dash.points?.balance ?? '0', 10);
  const totalSpent = parseInt(dash.orders?.total_spent_points ?? '0', 10);

  return (
    <AppShell title="我的">
      {/* 用户 hero · 渐变背景 */}
      <div className="bg-gradient-soft px-5 pb-5 pt-5">
        <div className="flex items-center gap-4">
          <Avatar size={72} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-serif-cn text-xl font-bold text-ink-800">
              {user?.displayName ?? '匿名用户'}
            </div>
            <div className="label-cormorant mt-1 text-[10px]">
              ID · {user?.id.slice(0, 12)}…
            </div>
          </div>
        </div>

        {/* 积分大卡（渐变） */}
        <div className="mt-5 overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">POINTS BALANCE</div>
          <div className="mt-1 flex items-end gap-2">
            <div className="text-display text-4xl font-bold num">{points.toLocaleString()}</div>
            <div className="pb-1 text-xs text-white/80">积分</div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[11px]">
            <span className="text-white/80">
              累计消费 <span className="text-display font-bold text-white num">{totalSpent.toLocaleString()}</span>
            </span>
            <Link
              href="/me/recharge"
              className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur transition active:scale-95"
            >
              去充值 →
            </Link>
          </div>
        </div>

        {/* 三栏统计 */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="ORDERS" zh="订单" value={dash.orders?.total_orders ?? 0} />
          <Stat label="FAVORITES" zh="收藏" value={dash.relationships?.favorite_count ?? 0} />
          <Stat
            label="REWARDS"
            zh="邀请奖励"
            value={parseInt(dash.invite_reward?.invite_reward_points ?? '0', 10).toLocaleString()}
          />
        </div>
      </div>

      {/* 菜单列表 */}
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
