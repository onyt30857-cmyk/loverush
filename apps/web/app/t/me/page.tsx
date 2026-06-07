'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { Avatar, GhostButton, LoadingFull } from '@/components/ui';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api';
import { isOrderVoiceEnabled, setOrderVoiceEnabled, primeOrderVoice, playNewOrderAlert } from '@/lib/orderVoice';

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
  const [voiceOn, setVoiceOn] = useState(false);
  useEffect(() => setVoiceOn(isOrderVoiceEnabled()), []);

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    setOrderVoiceEnabled(next);
    if (next) {
      primeOrderVoice(); // 此刻是用户手势 → 解锁音频
      playNewOrderAlert(); // 试播一次让技师确认能听到
    }
  }

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
  const verifyHint =
    me.verificationStatus === 'passed'
      ? '✓'
      : me.verificationStatus === 'pending' || me.verificationStatus === 'in_review'
        ? '审核中'
        : me.verificationStatus === 'failed'
          ? '未通过'
          : '未提交';
  // 去重:「我的订单」「排班」已在底部导航(订单 tab / 中央排班按钮),不再重复列在菜单。
  // 分组卡片式:经营 / 内容与形象 / 账户设置 —— 更高级大气简约。
  const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string; icon: string; hint?: string }> }> = [
    {
      title: '经营',
      items: [
        { href: '/t/me/earnings', label: '收益与提现', icon: '💰' },
        { href: '/t/me/calendar', label: '经营日历', icon: '📅' },
        { href: '/t/me/wallet', label: '钱包账单', icon: '💳' },
        { href: '/t/me/shows', label: '节目管理 · 发布服务', icon: '🎫' },
        { href: '/t/me/reviews', label: '我的评价', icon: '⭐' },
      ],
    },
    {
      title: '内容与形象',
      items: [
        { href: '/t/me/profile', label: '完善档案', icon: '✏️', hint: `${completeness}%` },
        { href: '/t/me/media', label: '媒体管理', icon: '📷' },
        { href: '/t/me/chat-media', label: '聊天素材库', icon: '🔥' },
        { href: '/t/me/ai-alter', label: '分身设置', icon: '✨' },
        { href: '/t/me/verify', label: '真人核验', icon: '🆔', hint: verifyHint },
      ],
    },
  ];
  const SETTINGS_LINKS = [
    { href: '/me/notifications', label: '消息通知', icon: '🔔' },
    { href: '/me/notification-settings', label: '通知设置', icon: '⚙️' },
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
                  {m.hint && <span className="text-[12px] text-ink-400">{m.hint}</span>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
                </Link>
              ))}
            </div>
          </section>
        ))}

        {/* 账户设置(含新订单语音播报开关) */}
        <section className="px-4 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="mb-2 px-1.5 text-[11px] font-medium tracking-[0.12em] text-ink-400">账户设置</div>
          <div className="overflow-hidden rounded-2xl bg-white shadow-warm-xs divide-y divide-warm-50">
            <button
              type="button"
              onClick={toggleVoice}
              className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition active:bg-warm-50/60"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warm-50 text-[17px]">🔊</span>
              <span className="flex-1">
                <span className="block text-[14.5px] text-ink-800">新订单语音播报</span>
                <span className="block text-[11px] text-ink-400">
                  {voiceOn ? '开着 · 应用打开时出声提醒' : '点这里开启 · 顺便试听'}
                </span>
              </span>
              <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${voiceOn ? 'bg-primary' : 'bg-ink-200'}`}>
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${voiceOn ? 'left-[1.125rem]' : 'left-0.5'}`}
                />
              </span>
            </button>
            {SETTINGS_LINKS.map((m) => (
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
      </div>

      <div className="px-5 pb-8 pt-7">
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
