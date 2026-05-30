/**
 * 9 步首见 Onboarding 主页 · 对齐 0522 信息采集表
 *
 * 全屏沉浸 · 不显底部 nav · 模态体验。
 *
 * 流程驱动:
 *   1. 进入 → POST /assistant/onboarding/step { step:1, payload:{} } 拿首条 AI 台词
 *   2. 用户应答(选项 / swipe / 多组 chips / textarea)→ call step → 拿下一句
 *   3. next_step==='done' → 显完成页 → router.replace('/assistant')
 *
 * 后端不可用降级:简易本地剧本(step 1-3 文本回退,步 4+ 提示后端不可用)。
 *
 * 完成判定:
 *  - 走完 step 9 → localStorage 标 onboarding_done
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
import { GroupedChipsForm } from '@/components/onboarding/GroupedChipsForm';
import { TextareaInputs } from '@/components/onboarding/TextareaInputs';
import { OnboardingComplete } from '@/components/onboarding/OnboardingComplete';
import type {
  OnboardingOption,
  OnboardingStep,
  OnboardingStepResponse,
  OnboardingSwipeCard,
  OnboardingTextarea,
} from '@/components/onboarding/types';
import type { RecommendItem } from '@/components/RecommendCard';
import { apiPost, getAccessToken } from '@/lib/api';

const ONBOARDING_DONE_KEY = 'assistant_onboarding_done_v1';
const TOTAL_STEPS = 9;

interface MessageBubbleData {
  role: 'assistant' | 'user';
  text: string;
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
  const [textareas, setTextareas] = useState<OnboardingTextarea[] | undefined>(undefined);
  const [recommendations, setRecommendations] = useState<RecommendItem[]>([]);
  const [selectedOpts, setSelectedOpts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAuthed(!!getAccessToken());
  }, []);

  async function loadStep(s: OnboardingStep, payload: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    setOptions(undefined);
    setSwipeCards(undefined);
    setTextareas(undefined);
    setSelectedOpts([]);
    setAiDone(false);

    try {
      const resp = await apiPost<OnboardingStepResponse>('/assistant/onboarding/step', {
        step: s,
        payload,
      });
      applyStepResponse(resp);
    } catch (e) {
      setError('小助理走神了一下,稍等再问。');
      // 兜底:仍把当前 step 显示一个最小 reply
      applyStepResponse({
        next_step: s,
        ai_reply: '稍等 · 我刚走神了一下。',
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
    setTextareas(resp.visible_textareas);
    if (resp.first_recommendation) {
      setRecommendations(resp.first_recommendation);
    }
  }

  useEffect(() => {
    if (authed !== true) return;
    void loadStep(1, {});
  }, [authed]);

  async function nextStep(userAnswer: string, payload: Record<string, unknown>) {
    setHistory((cur) => [
      ...cur,
      { role: 'assistant', text: currentAIReply, instant: true },
      { role: 'user', text: userAnswer },
    ]);

    const ns = (step + 1) as OnboardingStep;
    if (ns > TOTAL_STEPS) {
      markLocalDone();
      setCompleted(true);
      return;
    }
    setStep(ns);
    await loadStep(ns, payload);
  }

  async function skip() {
    setHistory((cur) => [
      ...cur,
      { role: 'assistant', text: currentAIReply, instant: true },
      { role: 'user', text: '先看看' },
    ]);
    setStep(TOTAL_STEPS);
    await loadStep(TOTAL_STEPS, { skipped: true, skipped_from: step });
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

  // step 9 AI 台词显完 → 自动标完成
  useEffect(() => {
    if (step === TOTAL_STEPS && aiDone && !completed) {
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
        <div className="mt-1.5 text-center text-[10px] text-ink-400">{step}/{TOTAL_STEPS} · 不催</div>
      </header>

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

      <div className="border-t border-warm-100 bg-white/95 px-4 pb-5 pt-3 backdrop-blur max-h-[60vh] overflow-y-auto">
        <StepInteraction
          step={step}
          aiDone={aiDone}
          options={options}
          swipeCards={swipeCards}
          textareas={textareas}
          selected={selectedOpts}
          submitting={submitting}
          onSelect={setSelectedOpts}
          onConfirmText={(text) => void nextStep(text, { text, city: text })}
          onConfirmOption={(values) => {
            const labels = (options ?? [])
              .filter((o) => values.includes(o.value))
              .map((o) => o.label)
              .join(' / ');
            void nextStep(labels || values.join(' / '), { values, step });
          }}
          onConfirmSwipe={(kept, swiped) => {
            const tag = `选 ${kept.length} · 划 ${swiped.length}`;
            void nextStep(tag, { liked: kept, skipped_cards: swiped });
          }}
          onConfirmGrouped={(grouped) => {
            // 把每组的中文 label 拼出来给用户气泡显示
            const summaryParts: string[] = [];
            for (const [g, v] of Object.entries(grouped)) {
              const vals = Array.isArray(v) ? v : [v];
              const labels = (options ?? [])
                .filter((o) => o.group === g && vals.includes(o.value))
                .map((o) => o.label);
              if (labels.length) summaryParts.push(labels.join('/'));
            }
            const summary = summaryParts.join(' · ') || '已选';
            void nextStep(summary, grouped);
          }}
          onConfirmTextareas={(payload) => {
            const parts = Object.entries(payload).map(([k, v]) => {
              const t = (textareas ?? []).find((x) => x.name === k);
              return `${t?.label ?? k}: ${(v as string).slice(0, 30)}${(v as string).length > 30 ? '…' : ''}`;
            });
            const summary = parts.join(' · ') || '已写';
            void nextStep(summary, payload);
          }}
          onSkipTextareas={() => void nextStep('跳过', { skipped: true })}
        />
      </div>
    </ModalShell>
  );
}

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
  textareas?: OnboardingTextarea[];
  selected: string[];
  submitting: boolean;
  onSelect: (v: string[]) => void;
  onConfirmText: (text: string) => void;
  onConfirmOption: (values: string[]) => void;
  onConfirmSwipe: (kept: string[], swiped: string[]) => void;
  onConfirmGrouped: (grouped: Record<string, string | string[]>) => void;
  onConfirmTextareas: (payload: Record<string, string>) => void;
  onSkipTextareas: () => void;
}

function StepInteraction(props: StepInteractionProps) {
  const {
    step,
    aiDone,
    options,
    swipeCards,
    textareas,
    selected,
    submitting,
    onSelect,
    onConfirmText,
    onConfirmOption,
    onConfirmSwipe,
    onConfirmGrouped,
    onConfirmTextareas,
    onSkipTextareas,
  } = props;

  const suggestions = useMemo(() => {
    if (step === 1) return ['曼谷', '吉隆坡', '新加坡', '胡志明', '雅加达'];
    return undefined;
  }, [step]);

  if (!aiDone) {
    return (
      <div className="flex h-12 items-center justify-center text-[11px] text-ink-400">
        小助理正在说…
      </div>
    );
  }

  // 步 3 swipe
  if (step === 3 && swipeCards && swipeCards.length > 0) {
    return <StyleSwipeGrid cards={swipeCards} onSubmit={onConfirmSwipe} disabled={submitting} />;
  }

  // 步 8-9 textarea
  if (textareas && textareas.length > 0) {
    return (
      <TextareaInputs
        textareas={textareas}
        submitting={submitting}
        ctaLabel={step === 9 ? '齐了 · 看 3 个推荐' : '下一步'}
        onSubmit={onConfirmTextareas}
        onSkip={onSkipTextareas}
      />
    );
  }

  // 步 4-7 多组 chips(options 有 group 字段)
  const hasGroups = (options ?? []).some((o) => !!o.group);
  if (hasGroups && options && options.length > 0) {
    return (
      <GroupedChipsForm
        options={options}
        submitting={submitting}
        onSubmit={onConfirmGrouped}
      />
    );
  }

  // 步 2 单组多选 + 步 1 等单组单选
  if (options && options.length > 0) {
    const multi = step === 2; // step 2 主要关注多选
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

  // 步 1 文本兜底
  return (
    <IntentTextInput
      placeholder={step === 1 ? '比如:曼谷' : '直接说就好'}
      onSubmit={onConfirmText}
      disabled={submitting}
      suggestions={suggestions}
    />
  );
}
