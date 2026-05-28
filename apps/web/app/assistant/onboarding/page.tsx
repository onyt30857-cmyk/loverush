/**
 * 6 步首见 Onboarding 主页(全屏模态)· M03 v2 F03-OB1
 *
 * 全屏沉浸 · 不显底部 nav · 模态体验。
 *
 * 流程驱动:
 *   1. 进入 → call POST /assistant/onboarding/step { step:1, payload:{} } 拿首条 AI 台词
 *   2. 用户应答(选项 / swipe / 文本)→ call step API → 拿下一句 + 下步呈现资源
 *   3. next_step==='done' → 显完成页 → 用户点继续 → router.replace('/assistant')
 *
 * 后端不可用降级:本地剧本(同样 6 轮 · 文案对齐 PRD §3.0.1)+ 占位 swipe 卡。
 * 不留 TODO · 任何路径都能跑完。
 *
 * 完成判定 F03-OB3:
 *  - 走完轮 6 → localStorage 标 onboarding_done
 *  - 任意轮"先看看" → 直接标完成 + 跳走
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { AITypingBubble } from '@/components/onboarding/AITypingBubble';
import { OptionPills } from '@/components/onboarding/OptionPills';
import { StyleSwipeGrid } from '@/components/onboarding/StyleSwipeGrid';
import { IntentTextInput } from '@/components/onboarding/IntentTextInput';
import { OnboardingComplete } from '@/components/onboarding/OnboardingComplete';
import type {
  OnboardingOption,
  OnboardingStep,
  OnboardingStepResponse,
  OnboardingSwipeCard,
} from '@/components/onboarding/types';
import type { RecommendItem } from '@/components/RecommendCard';
import { apiPost, getAccessToken } from '@/lib/api';

const ONBOARDING_DONE_KEY = 'assistant_onboarding_done_v1';

/** 本地兜底剧本 · 后端 503 时也能跑完 6 步 */
const LOCAL_SCRIPT: Record<OnboardingStep, Omit<OnboardingStepResponse, 'next_step'>> = {
  1: {
    ai_reply:
      '嘿 · 我是你的小助理。帮你过滤花里胡哨踩雷率高的店,直接挑能下单的。我免费,聊多少都行。先说,你这会儿在哪个城?',
  },
  2: {
    ai_reply: '懂了,你那边我熟。你今晚是哪种状态?直觉选。',
    visible_options: [
      { label: '工作累成狗 · 想躺平', value: 'tired' },
      { label: '手法到位 · 想好好松开', value: 'relief' },
      { label: '换换心情 · 看看新地方', value: 'explore' },
    ],
  },
  3: {
    ai_reply:
      '行,我给你看 6 张风格图,顺眼直接点,看不上长按划走。不用解释,我看反应就懂——比你描述快多了。',
    visible_swipe_cards: [
      { id: 's1', img_url: '', tags: ['温柔', '邻家'] },
      { id: 's2', img_url: '', tags: ['御姐', '成熟'] },
      { id: 's3', img_url: '', tags: ['甜美', '清新'] },
      { id: 's4', img_url: '', tags: ['健身', '阳光'] },
      { id: 's5', img_url: '', tags: ['古典', '文艺'] },
      { id: 's6', img_url: '', tags: ['时尚', '冷艳'] },
    ],
  },
  4: {
    ai_reply: '看出来了 · 给你心里有数了。最后两件小事:几点比较方便?语言要中文还是英文?',
    visible_options: [
      { label: '中午前后', value: 'noon' },
      { label: '下午到傍晚', value: 'afternoon' },
      { label: '今晚 8-11 点', value: 'evening' },
      { label: '深夜 11+', value: 'late' },
    ],
  },
  5: {
    ai_reply:
      '还有 · 有些哥们在意预算和隐私 · 你有预算上限要卡着?另外 · 介意我用代号代直接金额吗?',
    visible_options: [
      { label: '无所谓 · 直接报价', value: 'open_price' },
      { label: '500 积分以内', value: 'cap_500' },
      { label: '1000 积分以内', value: 'cap_1000' },
      { label: '用代号 · 别报具体数', value: 'code_only' },
    ],
  },
  6: {
    ai_reply:
      '齐活。基于你刚说的,我给你挑了 3 个最稳的 · 这条线里今天评价没翻车的。觉得对味点进去,不行回来换。',
    first_recommendation: [],
  },
};

interface MessageBubbleData {
  role: 'assistant' | 'user';
  text: string;
  /** 该条是回填(不重打字) */
  instant?: boolean;
}

export default function AssistantOnboardingPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [step, setStep] = useState<OnboardingStep>(1);
  const [history, setHistory] = useState<MessageBubbleData[]>([]);
  const [currentAIReply, setCurrentAIReply] = useState<string>('');
  const [aiReplyInstant, setAiReplyInstant] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [options, setOptions] = useState<OnboardingOption[] | undefined>(undefined);
  const [swipeCards, setSwipeCards] = useState<OnboardingSwipeCard[] | undefined>(undefined);
  const [recommendations, setRecommendations] = useState<RecommendItem[]>([]);
  const [selectedOpts, setSelectedOpts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAuthed(!!getAccessToken());
  }, []);

  // 拉取某一步资源(优先后端,降级本地)
  async function loadStep(s: OnboardingStep, payload: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    setOptions(undefined);
    setSwipeCards(undefined);
    setSelectedOpts([]);
    setAiDone(false);

    try {
      const resp = await apiPost<OnboardingStepResponse>('/assistant/onboarding/step', {
        step: s,
        payload,
      });
      applyStepResponse(resp);
    } catch {
      // 后端不可用 · 用本地剧本
      const local = LOCAL_SCRIPT[s];
      applyStepResponse({
        next_step: s === 6 ? 'done' : ((s + 1) as OnboardingStep),
        ai_reply: local.ai_reply,
        visible_options: local.visible_options,
        visible_swipe_cards: local.visible_swipe_cards,
        first_recommendation: local.first_recommendation,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function applyStepResponse(resp: OnboardingStepResponse) {
    setCurrentAIReply(resp.ai_reply);
    setAiReplyInstant(false);
    setOptions(resp.visible_options);
    setSwipeCards(resp.visible_swipe_cards);
    if (resp.first_recommendation) {
      setRecommendations(resp.first_recommendation);
    }
    // next_step === 'done' 在 finishStepCallback 时由组件外层处理
  }

  // 进入即触发轮 1 · loadStep 仅依赖 authed,其他 setter 引用稳定
  useEffect(() => {
    if (authed !== true) return;
    void loadStep(1, {});
  }, [authed]);

  /** 把用户回答推进 history · 切下一轮 */
  async function nextStep(userAnswer: string, payload: Record<string, unknown>) {
    // 把当前 AI 台词归档进 history(回填模式 · 不再打字)
    setHistory((cur) => [
      ...cur,
      { role: 'assistant', text: currentAIReply, instant: true },
      { role: 'user', text: userAnswer },
    ]);

    const ns = (step + 1) as OnboardingStep;
    if (ns > 6) {
      // 已是最后一步的提交 · 标完成
      markLocalDone();
      setCompleted(true);
      return;
    }
    setStep(ns);
    await loadStep(ns, payload);
  }

  /** "先看看" · 跳到轮 6 · 用默认值 */
  async function skip() {
    // 把当前 AI 台词归档
    setHistory((cur) => [
      ...cur,
      { role: 'assistant', text: currentAIReply, instant: true },
      { role: 'user', text: '先看看' },
    ]);
    setStep(6);
    await loadStep(6, { skipped_from: step });
  }

  function markLocalDone() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      }
    } catch {
      // ignore
    }
  }

  function finishToHome() {
    markLocalDone();
    router.replace('/assistant');
  }

  // 完成态(轮 6 AI 台词显完)· 标 local done
  useEffect(() => {
    if (step === 6 && aiDone && !completed) {
      markLocalDone();
      setCompleted(true);
    }
  }, [step, aiDone, completed]);

  if (completed) {
    return (
      <ModalShell>
        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
          <OnboardingComplete
            reply={currentAIReply}
            recommendations={recommendations}
            onContinue={finishToHome}
          />
        </div>
      </ModalShell>
    );
  }

  // 未登录引导
  if (authed === null) {
    return (
      <ModalShell>
        <div className="flex flex-1 items-center justify-center">
          <span className="text-[12px] text-ink-400">加载中…</span>
        </div>
      </ModalShell>
    );
  }
  if (!authed) {
    return (
      <ModalShell>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <h1 className="text-serif-cn text-[18px] font-bold text-ink-800">先登录再开始</h1>
          <p className="mt-2 max-w-[260px] text-[13px] leading-7 text-ink-500">
            登录后小助理记得你的偏好
          </p>
          <button
            type="button"
            onClick={() => router.replace('/')}
            className="mt-6 rounded-full bg-gradient-cta px-8 py-2.5 text-[14px] font-medium text-white shadow-rose-md active:scale-95"
          >
            去登录
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell>
      {/* 顶部:进度 + "先看看" 跳过 */}
      <header className="sticky top-0 z-10 border-b border-warm-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.replace('/assistant')}
            aria-label="退出 onboarding"
            className="-ml-1 flex h-7 w-7 items-center justify-center rounded-full text-ink-400 active:bg-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1">
            <OnboardingProgress step={step} />
          </div>
          <button
            type="button"
            onClick={() => void skip()}
            disabled={submitting}
            aria-label="先看看 · 跳过"
            className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline disabled:opacity-50"
          >
            先看看 →
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10px] text-ink-400">{step}/6 · 不催</div>
      </header>

      {/* 对话流 */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 pt-3 space-y-2.5">
        {history.map((m, i) =>
          m.role === 'assistant' ? (
            <AITypingBubble key={`h-${i}`} text={m.text} instant />
          ) : (
            <UserBubble key={`u-${i}`} text={m.text} />
          ),
        )}
        {currentAIReply && (
          <AITypingBubble
            key={`step-${step}`}
            text={currentAIReply}
            instant={aiReplyInstant}
            onDone={() => setAiDone(true)}
          />
        )}
        {error && (
          <div className="mx-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] text-primary">
            {error}
          </div>
        )}
      </div>

      {/* 底部交互区 · 根据 step 切换 */}
      <div className="border-t border-warm-100 bg-white/95 px-4 pb-5 pt-3 backdrop-blur">
        <StepInteraction
          step={step}
          aiDone={aiDone}
          options={options}
          swipeCards={swipeCards}
          selected={selectedOpts}
          submitting={submitting}
          onSelect={setSelectedOpts}
          onConfirmText={(text) => void nextStep(text, { text, step })}
          onConfirmOption={(values) => {
            const labels = (options ?? [])
              .filter((o) => values.includes(o.value))
              .map((o) => o.label)
              .join(' / ');
            void nextStep(labels || values.join(' / '), { values, step });
          }}
          onConfirmSwipe={(kept, swiped) => {
            const tag = `选 ${kept.length} · 划 ${swiped.length}`;
            void nextStep(tag, { kept, swiped, step });
          }}
        />
      </div>
    </ModalShell>
  );
}

// ──────────────── 子组件 ────────────────

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mobile-container flex h-screen flex-col overflow-hidden bg-gradient-soft">
      {children}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end animate-fade-up">
      <div className="msg-bubble-mine max-w-[78%]">{text}</div>
    </div>
  );
}

interface StepInteractionProps {
  step: OnboardingStep;
  aiDone: boolean;
  options?: OnboardingOption[];
  swipeCards?: OnboardingSwipeCard[];
  selected: string[];
  submitting: boolean;
  onSelect: (v: string[]) => void;
  onConfirmText: (text: string) => void;
  onConfirmOption: (values: string[]) => void;
  onConfirmSwipe: (kept: string[], swiped: string[]) => void;
}

function StepInteraction(props: StepInteractionProps) {
  const { step, aiDone, options, swipeCards, selected, submitting, onSelect, onConfirmText, onConfirmOption, onConfirmSwipe } = props;

  const suggestions = useMemo(() => {
    if (step === 1) return ['曼谷', '吉隆坡', '新加坡', '胡志明', '雅加达'];
    return undefined;
  }, [step]);

  // AI 台词没显完时 · 底部显减灰提示("等他说完")
  if (!aiDone) {
    return (
      <div className="flex h-12 items-center justify-center text-[11px] text-ink-400">
        小助理正在说…
      </div>
    );
  }

  // 轮 3 看图说话
  if (step === 3 && swipeCards && swipeCards.length > 0) {
    return <StyleSwipeGrid cards={swipeCards} onSubmit={onConfirmSwipe} disabled={submitting} />;
  }

  // 轮 2/4/5 选项
  if (options && options.length > 0) {
    const multi = step === 5; // 5 隐私+价格 可多选(预算+代号)
    return (
      <div className="space-y-3">
        <OptionPills
          options={options}
          multi={multi}
          selected={selected}
          onSelect={onSelect}
          disabled={submitting}
        />
        <button
          type="button"
          disabled={submitting || selected.length === 0}
          onClick={() => onConfirmOption(selected)}
          className="w-full rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white shadow-rose-md transition active:scale-[0.98] disabled:opacity-40"
        >
          下一步
        </button>
      </div>
    );
  }

  // 轮 1 文本(城市)+ 兜底
  return (
    <IntentTextInput
      placeholder={step === 1 ? '比如:曼谷' : '直接说就好'}
      onSubmit={onConfirmText}
      disabled={submitting}
      suggestions={suggestions}
    />
  );
}
