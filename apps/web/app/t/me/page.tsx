'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { Avatar, GhostButton, LoadingFull } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';

interface MyProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  verificationStatus: string;
  profileCompleteness?: number;
  onlineStatus: string;
  scoreService: number;
  ratingCount: number;
  completedOrders: number;
}

export default function TherapistMePage() {
  const { logout } = useAuth();
  const [me, setMe] = useState<MyProfile | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setMe(await apiGet<MyProfile>('/therapists/me'));
      } catch {
        setMe({} as MyProfile);
      }
    })();
  }, []);

  if (!me) return <TherapistShell><LoadingFull /></TherapistShell>;

  const completeness = me.profileCompleteness ?? 0;
  const menu = [
    { href: '/t/me/profile', label: '完善档案', icon: '✏️', hint: `${completeness}%` },
    { href: '/t/me/ai-alter', label: '分身设置', icon: '✨' },
    { href: '/t/me/earnings', label: '收益与提现', icon: '💰' },
    { href: '/t/orders', label: '我的订单', icon: '📦' },
    { href: '/t/me/verify', label: '真人核验', icon: '🪪' },
    { href: '/me/notifications', label: '通知设置', icon: '🔔' },
    { href: '/me/privacy', label: '隐私模式', icon: '🔒' },
  ];

  return (
    <TherapistShell>
      {/* 用户 hero */}
      <div className="bg-gradient-soft px-5 pb-5 pt-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar src={me.avatarUrl ?? undefined} size={72} />
            {me.onlineStatus === 'online' && (
              <span className="absolute bottom-0 right-0 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-warm-sm">
                <span className="h-2 w-2 rounded-full bg-success-500 animate-dot-pulse" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-serif-cn text-xl font-bold text-ink-800">
              {me.displayName ?? '未设置昵称'}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {me.verificationStatus === 'passed' ? (
                <span className="rounded-full bg-success-500/10 px-2 py-0 text-[10px] font-medium text-success-500">
                  ✓ 已核验
                </span>
              ) : (
                <span className="rounded-full bg-warning-500/10 px-2 py-0 text-[10px] font-medium text-warning-500">
                  ⚠ 未核验
                </span>
              )}
              <span className="text-[10px] text-ink-600">
                {me.onlineStatus === 'online' ? '在线' : '离线'}
              </span>
            </div>
          </div>
        </div>

        {/* 完整度进度 */}
        {completeness < 100 && (
          <Link
            href="/t/me/profile"
            className="mt-4 block rounded-2xl border border-warm-200 bg-warm-50 p-3 transition active:scale-[0.98]"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-warm-700">
                档案完整度 <span className="text-display font-bold num">{completeness}%</span>
              </span>
              <span className="text-warm-700">完善更多 →</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white">
              <div className="h-full bg-gradient-warm-rose" style={{ width: `${completeness}%` }} />
            </div>
          </Link>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="ORDERS" zh="完成单数" value={me.completedOrders ?? 0} />
          <Stat label="REVIEWS" zh="评价" value={me.ratingCount ?? 0} />
          <Stat
            label="RATING"
            zh="服务分"
            value={((me.scoreService ?? 0) / 10).toFixed(1)}
          />
        </div>
      </div>

      {/* 菜单 */}
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
              {m.hint && (
                <span className="text-display text-xs font-bold text-warm-500 num">{m.hint}</span>
              )}
              <span className="text-lg text-ink-300">›</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="px-5 py-6">
        <GhostButton onClick={logout}>退出登录</GhostButton>
      </div>
    </TherapistShell>
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
