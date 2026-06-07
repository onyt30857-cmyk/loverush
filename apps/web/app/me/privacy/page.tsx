'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPut, ApiClientError } from '@/lib/api';

/**
 * 隐私模式 · 诚实版(2026-06-07)
 *
 * 只展示【真能用】的开关。此前的 PIN 锁 / 通知伪装名 / 配偶手势 / 银行外显名
 * 均为假开关(设了不生效:PIN 没有门校验、伪装名无后端、手势是占位、银行无支付处理商),
 * 给用户虚假安全感比没有更危险,已全部撤下。
 * 真正的 App PIN 锁(含自动锁/找回)需补认证地基,作为 pre-launch 专项,在下方诚实标「即将上线」。
 */

interface PrivacyState {
  obfuscateNotifications: number;
}

// 即将上线的隐私能力(诚实预告,不是可点开关,绝不假装已生效)
const COMING_SOON = [
  { icon: '🔐', label: 'App PIN 锁 · 自动锁定', desc: '进入 App 需 PIN,无操作 / 切后台自动锁' },
  { icon: '🕶️', label: '通知伪装 · 图标伪装', desc: '锁屏推送与桌面图标显示为中性名字' },
  { icon: '📸', label: '防截图 · 阅后即焚', desc: '私聊真人照防截屏 + 一次性查看' },
];

export default function PrivacyPage() {
  const [state, setState] = useState<PrivacyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiGet<PrivacyState>('/privacy');
      setState(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleObfuscate(value: boolean) {
    // 乐观更新,失败回滚
    setState((s) => (s ? { ...s, obfuscateNotifications: value ? 1 : 0 } : s));
    try {
      const data = await apiPut<PrivacyState>('/privacy', { obfuscate_notifications: value });
      setState(data);
    } catch (err) {
      setState((s) => (s ? { ...s, obfuscateNotifications: value ? 0 : 1 } : s));
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (!state) {
    return (
      <AppShell title="隐私模式" showBack hideTabBar>
        {error ? <ErrorBanner message={error} /> : <LoadingFull />}
      </AppShell>
    );
  }

  return (
    <AppShell title="隐私模式" showBack hideTabBar>
      <div className="bg-gradient-soft px-5 pb-3 pt-3 animate-fade-up">
        <div className="gradient-orb h-12 w-12 text-xl">🔒</div>
        <div className="label-cormorant mt-3">PRIVACY MODE</div>
        <p className="mt-2 text-[12px] leading-7 text-ink-600">
          保护你的隐私,只显示已经真正生效的开关。
        </p>
      </div>

      <div className="space-y-5 px-4 py-5">
        <ErrorBanner message={error} />

        {/* 已生效 */}
        <section>
          <div className="mb-2 px-1.5 text-[11px] font-medium tracking-[0.12em] text-ink-400">已生效</div>
          <div className="overflow-hidden rounded-2xl bg-white shadow-warm-xs">
            <div className="flex items-center gap-3.5 px-4 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warm-50 text-[17px]">🔔</span>
              <span className="flex-1">
                <span className="block text-[14.5px] text-ink-800">通知内容模糊</span>
                <span className="block text-[11px] text-ink-400">推送只显示「新消息」,不显示具体内容</span>
              </span>
              <button
                type="button"
                onClick={() => void toggleObfuscate(state.obfuscateNotifications !== 1)}
                className={`relative h-6 w-10 shrink-0 rounded-full transition ${
                  state.obfuscateNotifications === 1 ? 'bg-primary' : 'bg-ink-200'
                }`}
                aria-label="通知内容模糊"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    state.obfuscateNotifications === 1 ? 'left-[1.125rem]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* 即将上线 · 诚实预告,不可点 */}
        <section>
          <div className="mb-2 px-1.5 text-[11px] font-medium tracking-[0.12em] text-ink-400">即将上线</div>
          <div className="overflow-hidden rounded-2xl bg-white shadow-warm-xs divide-y divide-warm-50">
            {COMING_SOON.map((it) => (
              <div key={it.label} className="flex items-center gap-3.5 px-4 py-4 opacity-60">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warm-50 text-[17px]">{it.icon}</span>
                <span className="flex-1">
                  <span className="block text-[14.5px] text-ink-700">{it.label}</span>
                  <span className="block text-[11px] text-ink-400">{it.desc}</span>
                </span>
                <span className="shrink-0 rounded-full bg-warm-100 px-2 py-0.5 text-[10px] text-ink-500">即将上线</span>
              </div>
            ))}
          </div>
          <p className="mt-2 px-1.5 text-[10.5px] leading-5 text-ink-400">
            这些保护正在开发,会在上线前完成。我们不会用假开关给你虚假的安全感。
          </p>
        </section>
      </div>
    </AppShell>
  );
}
