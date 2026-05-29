/**
 * 助手 Home 仪表盘 · M03 v3 重排(2026-05-29)
 *
 * PRD §3.0(v3) 6 区块 + InlineChatInput · 永不跳页:
 *   1. GreetingHeader            问候头(含 第 N 天)
 *   2. GreetingMemoryCard        跨次记忆 + CTA(null 隐藏)
 *   3. RecommendationStrip       3 张紧凑技师卡(永不空)
 *   4. RecentActivityFeed        最近行为/原话(空隐藏)
 *   5. InlineChatInput           常驻底 · 就地输入 · 不跳页
 *   - BottomNav                  AppShell 提供
 *
 * 行为变化(vs v2):
 *  ✗ 输入框点击 → 跳 /assistant/chat
 *  ✓ 输入框点击 → 键盘弹起 + 就地输入
 *  ✓ 第一次发送后:home 切 mode='chat' · 区块 2/3/4 折叠为 60px 摘要条 · 中间显示 HomeChatStream
 *  ✓ 顶部"展开 home"按钮 → 摘要条 → 重新展开区块 2/3/4
 *  ✓ /assistant/chat 全屏对话页保留(深度场景兜底)
 *
 * 后端契约:
 *  - GET /assistant/home 返回 v3 字段(后端 agent 并行做)
 *  - v3 未上线 → 自动用 v2 字段适配 + 编辑兜底
 *  - POST /assistant/home/refresh-picks 用于"换 3 个"按钮(失败静默)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { GradientOrb } from '@/components/ui';
import { GreetingHeader } from '@/components/assistant/GreetingHeader';
import { GreetingMemoryCard } from '@/components/assistant/GreetingMemoryCard';
import { RecommendationStrip } from '@/components/assistant/RecommendationStrip';
import { RecentActivityFeed } from '@/components/assistant/RecentActivityFeed';
import { InlineChatInput } from '@/components/assistant/InlineChatInput';
import type {
  AssistantHomeData,
  GreetingTone,
  SmartChip,
  TodayPicks,
} from '@/components/assistant/types';
import { apiGet, apiPost, getAccessToken } from '@/lib/api';
import { markAssistantUnread } from '@/lib/assistant-unread';

const STORAGE_KEY = 'assistant_home_cache_v3';
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
    case 'early':
      return '一早起来 · 想看点啥?';
    case 'morning':
      return '早上好哥们 · 今天有什么打算?';
    case 'afternoon':
      return '下午好 · 想换个心情?';
    case 'evening':
      return '晚上好 · 累了想松一下?';
    case 'late_night':
      return '夜深了 · 在想哪种放松?';
  }
}

/**
 * 兜底 today_picks · 后端未上线时返**空集** + 友好态
 *
 * 关键原则(2026-05-29 修订):
 *  - 前端绝不硬编假技师数据(Mira/Yuki/Linn 等)· 推荐必须真实
 *  - 后端 fallbackPicks 已查 verificationStatus='passed' 真技师 · 兜底由后端保证
 *  - 前端拿不到数据时:items=[] · 由 RecommendationStrip 显友好骨架态(不假装)
 */
function fallbackTodayPicks(): TodayPicks {
  return {
    reason_tag: '正在为你挑 · 一会儿来看',
    items: [],
    refresh_token: null,
  };
}

function fallbackSmartChips(): SmartChip[] {
  return [
    { key: 'tonight', label: '今晚有空', intent_seed: '今晚有空的都给我看看' },
    { key: 'nearby', label: '附近', intent_seed: '附近现在能约的有谁' },
    { key: 'cheap', label: '性价比', intent_seed: '性价比高的有谁' },
    { key: 'budget', label: '预算', intent_seed: '预算 200 积分以内的' },
  ];
}

/** 把 v2 旧契约 (today_cards / quick_acts) 提升到 v3 结构,保证灰度期不裸 */
function liftV2ToV3(d: AssistantHomeData): AssistantHomeData {
  const next: AssistantHomeData = { ...d };
  if (!next.today_picks) {
    next.today_picks = fallbackTodayPicks();
  }
  if (!next.smart_chips || next.smart_chips.length === 0) {
    // v2 → v3:quick_acts.label + intent_seed 即可当 smart_chip
    if (d.quick_acts && d.quick_acts.length > 0) {
      next.smart_chips = d.quick_acts.slice(0, 6).map((a) => ({
        key: a.key,
        label: a.label,
        intent_seed: a.intent_seed,
      }));
    } else {
      next.smart_chips = fallbackSmartChips();
    }
  }
  return next;
}

function defaultHomeData(): AssistantHomeData {
  const tone = currentTone();
  return {
    greeting: { text: toneGreet(tone), tone },
    memory_cta: null,
    today_picks: fallbackTodayPicks(),
    recent_activity: [],
    smart_chips: fallbackSmartChips(),
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
  const [refreshingPicks, setRefreshingPicks] = useState(false);

  useEffect(() => {
    setAuthed(!!getAccessToken());
    markAssistantUnread(false);
  }, []);

  useEffect(() => {
    if (authed !== true) return;

    // 首次访问 · 本地未标完成 → 直接跳 onboarding
    if (!localOnboardingDone()) {
      router.replace('/assistant/onboarding');
      return;
    }

    // 先用缓存填充 · 再背景刷新
    const cached = loadCache();
    if (cached) setData(liftV2ToV3(cached));

    let cancelled = false;
    void apiGet<AssistantHomeData>('/assistant/home')
      .then((d) => {
        if (cancelled) return;
        if (d.onboarding_required && !localOnboardingDone()) {
          router.replace('/assistant/onboarding');
          return;
        }
        const lifted = liftV2ToV3(d);
        setData(lifted);
        saveCache(lifted);
      })
      .catch(() => {
        if (cancelled) return;
        if (!cached) setData(defaultHomeData());
      });

    return () => {
      cancelled = true;
    };
  }, [authed, router]);

  // 用户点击 BottomNav 中央"助理"再次 → 如果在 chat 模式 → 切回 home(交互细节略,需要 nav 信号 · 此处先靠"展开 home"按钮)

  async function handleRefreshPicks() {
    setRefreshingPicks(true);
    try {
      const next = await apiPost<{ today_picks: TodayPicks }>('/assistant/home/refresh-picks', {
        refresh_token: data?.today_picks?.refresh_token ?? null,
      });
      if (next.today_picks && data) {
        const updated = { ...data, today_picks: next.today_picks };
        setData(updated);
        saveCache(updated);
      }
    } catch {
      // 后端未上线 · 本地轻量打乱顺序兜底
      if (data?.today_picks) {
        const shuffled = {
          ...data.today_picks,
          items: [...data.today_picks.items].reverse(),
        };
        const updated = { ...data, today_picks: shuffled };
        setData(updated);
      }
    } finally {
      setRefreshingPicks(false);
    }
  }

  // 输入框点击 / 发送 / chip / 预填 → 全部跳全屏对话页
  // 设计决策(2026-05-29 修订):
  //   用户实际体验后反馈"全屏对话不要有(按钮)去掉,点击下面的对话就跳转到二级全屏对话页面"
  //   → 移除 home 内嵌 chat 模式(原 Pi/Claude 内联模式)
  //   → 输入框就是跳页入口,顶部不再需要"全屏对话"快捷按钮
  function handleSendOrPrefill(text: string) {
    const trimmed = text.trim();
    if (trimmed) {
      router.push(`/assistant/chat?intent_seed=${encodeURIComponent(trimmed)}`);
    } else {
      router.push('/assistant/chat');
    }
  }

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
          <h1 className="mt-5 text-serif-cn text-[18px] font-bold text-ink-800">
            登录后 · 帮你找到对的人
          </h1>
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

  // 加载骨架 · 纯线条无图标
  if (!data) {
    return (
      <AppShell fill>
        <div className="flex flex-1 flex-col bg-gradient-soft">
          <div className="px-4 pt-4">
            <div className="space-y-2">
              <div className="skel h-3 w-32 rounded" />
              <div className="skel h-2 w-44 rounded" />
            </div>
          </div>
          <div className="space-y-3 px-4 pt-6">
            <div className="skel h-24 w-full rounded-2xl" />
            <div className="skel h-32 w-full rounded-2xl" />
            <div className="skel h-16 w-full rounded-2xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fill>
      <div className="flex flex-1 flex-col bg-gradient-soft">
        {/* 区块 1 问候头 */}
        <GreetingHeader greeting={data.greeting} />

        {/* 区块 2/3/4 · 中部填满 viewport */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <GreetingMemoryCard
            cta={data.memory_cta ?? null}
            onRefreshPicks={() => void handleRefreshPicks()}
            onChatPrefill={handleSendOrPrefill}
          />
          <RecommendationStrip
            picks={data.today_picks}
            onRefreshPicks={() => void handleRefreshPicks()}
            onChatPrefill={handleSendOrPrefill}
            refreshing={refreshingPicks}
          />
          <RecentActivityFeed items={data.recent_activity} />
          <div className="h-2" />
        </div>

        {/* 区块 5 · 输入框 · 点击 / 发送 / chip → 跳全屏对话页 */}
        <InlineChatInput chips={data.smart_chips} onSend={handleSendOrPrefill} />
      </div>
    </AppShell>
  );
}
