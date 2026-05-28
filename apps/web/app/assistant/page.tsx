/**
 * 助手 Home 仪表盘(模式 C · 中央 tab 着陆页)· M03 v2 F03-Home1
 *
 * PRD §3.0 五区块布局:
 *   1. GreetingHeader   问候头(时段+L1 + 设置入口)
 *   2. TodayCardsSection 主动 push(L5 diff / 偏好稳定 / 新人推荐)
 *   3. HistoryList       最近 3 条对话恢复入口
 *   4. QuickActsRow      4-6 个 chip(替代自由文本)
 *   5. DockInputBar      常驻输入条 → /assistant/chat
 *
 * 行为:
 *  - 进入时 GET /assistant/home,若 onboarding_required → router.replace('/assistant/onboarding')
 *  - 后端未上线时降级为本地默认数据(保证 next build 不依赖运行时 API)
 *  - localStorage 缓存上次 home payload(离线友好)
 *  - 未登录 → 引导登录态(不闪跳)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { GradientOrb } from '@/components/ui';
import { GreetingHeader } from '@/components/assistant/GreetingHeader';
import { TodayCardsSection } from '@/components/assistant/TodayCardsSection';
import { HistoryList } from '@/components/assistant/HistoryList';
import { QuickActsRow } from '@/components/assistant/QuickActsRow';
import { DockInputBar } from '@/components/assistant/DockInputBar';
import type { AssistantHomeData, GreetingTone } from '@/components/assistant/types';
import { apiGet, getAccessToken } from '@/lib/api';
import { markAssistantUnread } from '@/components/AssistantFab';

const STORAGE_KEY = 'assistant_home_cache_v1';
const ONBOARDING_DONE_KEY = 'assistant_onboarding_done_v1';

function currentTone(): GreetingTone {
  const h = new Date().getHours();
  if (h < 5) return 'late_night';
  if (h < 8) return 'early';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  if (h < 23) return 'evening';
  return 'late_night';
}

function toneGreet(t: GreetingTone): string {
  switch (t) {
    case 'early': return '一早起来 · 想看点啥?';
    case 'morning': return '早上好哥们 · 今天有什么打算?';
    case 'afternoon': return '下午好 · 想换个心情?';
    case 'evening': return '晚上好 · 累了想松一下?';
    case 'late_night': return '夜深了 · 在想哪种放松?';
  }
}

/** 后端没上线 / 失败时的默认 home 数据 · 保证页面始终可用 */
function defaultHomeData(): AssistantHomeData {
  const tone = currentTone();
  return {
    greeting: { text: toneGreet(tone), tone },
    today_cards: [],
    history: [],
    quick_acts: [
      { key: 'by-height', label: '按身高', intent_seed: '帮我按身高挑 1.65m+ 的' },
      { key: 'by-style', label: '按风格', intent_seed: '想看温柔风格的' },
      { key: 'tonight', label: '今晚有档', intent_seed: '今晚有档的都给我看看' },
      { key: 'nearby-now', label: '附近现在', intent_seed: '现在就要 · 附近有谁' },
      { key: 'budget', label: '预算内', intent_seed: '预算 200 积分以内的' },
      { key: 'last-time', label: '上次那种', intent_seed: '想要上次那种放松的' },
    ],
    onboarding_required: false,
  };
}

function loadCache(): AssistantHomeData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AssistantHomeData;
  } catch {
    return null;
  }
}

function saveCache(data: AssistantHomeData) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 静默
  }
}

function localOnboardingDone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ONBOARDING_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function AssistantHomePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [data, setData] = useState<AssistantHomeData | null>(null);

  useEffect(() => {
    setAuthed(!!getAccessToken());
    markAssistantUnread(false);
  }, []);

  useEffect(() => {
    if (authed !== true) return;

    // 首次访问 · 本地未标完成 → 直接跳 onboarding(避免空闪)
    // 后端 /assistant/home 上线后,onboarding_required 字段会更精确
    if (!localOnboardingDone()) {
      router.replace('/assistant/onboarding');
      return;
    }

    // 先用缓存填充 · 再背景刷新
    const cached = loadCache();
    if (cached) setData(cached);

    let cancelled = false;
    void apiGet<AssistantHomeData>('/assistant/home')
      .then((d) => {
        if (cancelled) return;
        // 后端 onboarding_required 优先;本地"已完成"标记可豁免后端
        if (d.onboarding_required && !localOnboardingDone()) {
          router.replace('/assistant/onboarding');
          return;
        }
        setData(d);
        saveCache(d);
      })
      .catch(() => {
        if (cancelled) return;
        // 后端不可用 · 用缓存或默认数据 · home 页静默降级
        if (!cached) {
          setData(defaultHomeData());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authed, router]);

  // 未登录提示
  if (authed === null) {
    return (
      <AppShell fill>
        <div className="flex flex-1 items-center justify-center bg-gradient-soft">
          <GradientOrb size={48} icon="✨" />
        </div>
      </AppShell>
    );
  }
  if (!authed) {
    return (
      <AppShell fill>
        <div className="flex flex-1 flex-col items-center justify-center bg-gradient-soft px-8 text-center">
          <GradientOrb size={72} icon="✨" />
          <h1 className="mt-5 text-serif-cn text-[18px] font-bold text-ink-800">登录后 · 帮你找到对的人</h1>
          <p className="mt-2 max-w-[260px] text-[13px] leading-7 text-ink-500">
            小助理按你的偏好推荐 · 先登录一下吧
          </p>
          <Link
            href="/"
            className="mt-6 rounded-full bg-gradient-cta px-8 py-2.5 text-[14px] font-medium text-white shadow-rose-md active:scale-95"
          >
            去登录 / 注册
          </Link>
        </div>
      </AppShell>
    );
  }

  // 加载中骨架(只在没缓存且首次拉取时)
  if (!data) {
    return (
      <AppShell fill>
        <div className="flex flex-1 flex-col bg-gradient-soft">
          <div className="px-4 pt-4">
            <div className="flex items-center gap-3">
              <GradientOrb size={48} icon="✨" />
              <div className="flex-1 space-y-2">
                <div className="skel h-3 w-32 rounded" />
                <div className="skel h-2 w-44 rounded" />
              </div>
            </div>
          </div>
          <div className="px-4 pt-6 space-y-3">
            <div className="skel h-24 w-full rounded-2xl" />
            <div className="skel h-16 w-full rounded-2xl" />
            <div className="skel h-16 w-full rounded-2xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fill>
      <div className="flex flex-1 flex-col bg-gradient-soft">
        <div className="flex-1 overflow-y-auto pb-2">
          <GreetingHeader greeting={data.greeting} />
          <TodayCardsSection cards={data.today_cards} />
          <HistoryList items={data.history} />
          <QuickActsRow acts={data.quick_acts} />
          {/* 底部留呼吸空间(常驻输入条 sticky 在视口底部) */}
          <div className="h-2" />
        </div>
        <DockInputBar />
      </div>
    </AppShell>
  );
}
