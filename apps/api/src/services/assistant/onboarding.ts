/**
 * 6 步首见对话 onboarding 状态机 · PRD §3.0.1
 *
 * 入口:onboardingStep(ctx, userId, step, payload, locale)
 * 流程:
 *   1. 读 customer_saved_memory.facts.onboarding_progress(累计 facts)
 *   2. 把 payload 合并进 facts 字段
 *   3. 处理跳过/空 payload 异常(F03-OB2)
 *   4. 决定 next_step:
 *      - skipped=true → 跳 step 6
 *      - 连续 2 步空 payload → 跳 step 6 + 自嘲
 *      - 否则 step + 1(到 6 后 done)
 *   5. 生成 ai_reply(基于已采集字段动态填充)
 *   6. 返回 visible_options / visible_swipe_cards / first_recommendation(仅 step 6)
 *   7. 完成时 UPDATE customer_saved_memory · 设 onboarding_complete=true
 *
 * 跳过即代表"先看看" · 缺失字段用默认值兜底:
 *   gender_pref = 'female' (默认占比最大群体)
 *   age_pref = ['26-32']
 *   style_pref = ['温柔']
 *   time_slot = 'flexible'
 *   language = 'zh'(中文 locale)/ 'en'(英文 locale)
 *   price_range = 'flexible'
 *   privacy_mode = 'codename'
 */

import { eq } from 'drizzle-orm';
import type { Database, CustomerSavedMemory } from '@loverush/db';
import { customerSavedMemory, users } from '@loverush/db';
import type { LLMGateway } from '@loverush/llm';
import { readSaved, upsertSaved, type MemoryContext } from './memory';
import { recommend as m03Recommend } from './recommender';
import { primeTodayPicksAfterOnboarding } from './home';
import { fireAndForget } from '../logger';
import { normalizeLocale, type AssistantLocale } from './voice';
import * as zh from './prompts/onboarding-zh';
import * as en from './prompts/onboarding-en';
import type { OnboardingFacts, OnboardingStep, NextStep, SwipePayload } from './onboarding-types';

export interface OnboardingContext extends MemoryContext {
  db: Database;
}

export interface OnboardingStepResult {
  next_step: NextStep;
  ai_reply: string;
  visible_options?: Array<{ label: string; value: string }>;
  visible_swipe_cards?: Array<{ id: string; img_url: string; tags: string[] }>;
  first_recommendation?: Array<{
    therapist_id: string;
    avatar_url: string | null;
    service_city: string | null;
    rating: number;
    online_status: string;
    match_score: number;
    reason: string;
  }>;
}

/** 取 zh / en 剧本模块 */
function script(locale: AssistantLocale): typeof zh {
  // 当前仅 zh + en 实现 · 其它 SEA 语言降级 zh(PRD §3.0.1 F03-OB4:中英先做,其它 P1)
  return locale === 'en' ? (en) : zh;
}

// ──────────────── facts 读写 ────────────────

interface SavedFactsWithProgress {
  onboarding_progress?: OnboardingFacts;
  /** 连续空 payload 计数(异常处理 F03-OB2) */
  onboarding_empty_streak?: number;
  /** 最后一次步骤号 */
  onboarding_last_step?: number;
  /** 完成判定(F03-OB3) */
  onboarding_complete?: boolean;
  [k: string]: unknown;
}

function readProgress(saved: CustomerSavedMemory | null): {
  facts: OnboardingFacts;
  emptyStreak: number;
  lastStep: number;
  complete: boolean;
} {
  const raw = (saved?.facts ?? {}) as SavedFactsWithProgress;
  return {
    facts: { ...(raw.onboarding_progress ?? {}) },
    emptyStreak: Number(raw.onboarding_empty_streak ?? 0),
    lastStep: Number(raw.onboarding_last_step ?? 0),
    complete: Boolean(raw.onboarding_complete ?? false),
  };
}

async function writeProgress(
  ctx: OnboardingContext,
  userId: string,
  patch: {
    facts: OnboardingFacts;
    emptyStreak: number;
    lastStep: number;
    complete: boolean;
  },
): Promise<void> {
  // 不 overwrite 原 facts 的其它字段(如 city/gender/language 已被 chat 抽取写入的)
  const existing = await readSaved(ctx, userId);
  const existingFacts = (existing?.facts ?? {}) as SavedFactsWithProgress;
  const factsPatch: SavedFactsWithProgress = {
    ...existingFacts,
    onboarding_progress: patch.facts,
    onboarding_empty_streak: patch.emptyStreak,
    onboarding_last_step: patch.lastStep,
    onboarding_complete: patch.complete,
  };
  // 完成时把核心字段提升到顶层 facts(供 L1 直接读)
  if (patch.complete) {
    if (patch.facts.city) factsPatch.city = patch.facts.city;
    if (patch.facts.language) factsPatch.language = patch.facts.language;
    if (patch.facts.gender_pref) factsPatch.gender_pref = patch.facts.gender_pref;
  }
  await upsertSaved(ctx, userId, {
    facts: factsPatch,
  });
}

/** 完成后把 stable_prefs 也写一遍(L2)*/
async function finalizeStablePrefs(
  ctx: OnboardingContext,
  userId: string,
  facts: OnboardingFacts,
): Promise<void> {
  const stable: Record<string, unknown> = {};
  if (Array.isArray(facts.style_pref) && facts.style_pref.length) {
    stable.priorities = facts.style_pref;
  }
  if (facts.price_range && facts.price_range !== 'flexible') {
    stable.priceBand = facts.price_range;
  }
  if (facts.privacy_mode) {
    stable.privacyMode = facts.privacy_mode;
  }
  if (Object.keys(stable).length) {
    await upsertSaved(ctx, userId, { stablePrefs: stable });
  }
}

// ──────────────── swipe 解析:从 cards 标签抽出 gender / age / style ────────────────

function parseSwipe(
  payload: SwipePayload,
  cards: Array<{ id: string; tags: string[] }>,
): { gender_pref?: string; age_pref?: string[]; style_pref?: string[] } {
  const liked = new Set((payload.liked ?? []).map(String));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const genders = new Set<string>();
  const ages = new Set<string>();
  const styles = new Set<string>();

  for (const id of liked) {
    const c = cardById.get(id);
    if (!c) continue;
    for (const t of c.tags) {
      const [k, v] = t.split(':');
      if (!v) continue;
      if (k === 'gender') genders.add(v);
      else if (k === 'age') ages.add(v);
      else if (k === 'style') styles.add(v);
    }
  }

  return {
    gender_pref: genders.size === 1 ? Array.from(genders)[0] : genders.size > 1 ? 'any' : undefined,
    age_pref: ages.size ? Array.from(ages) : undefined,
    style_pref: styles.size ? Array.from(styles) : undefined,
  };
}

// ──────────────── payload 合并 ────────────────

function isSkipped(payload: Record<string, unknown> | undefined | null): boolean {
  if (!payload) return false;
  return payload.skipped === true || payload.skip === true;
}

function isEmpty(payload: Record<string, unknown> | undefined | null): boolean {
  if (!payload) return true;
  // skip 不算空(有明确意图)
  if (isSkipped(payload)) return false;
  const keys = Object.keys(payload).filter((k) => k !== 'skipped' && k !== 'skip');
  if (keys.length === 0) return true;
  // 全是 null / undefined / 空字符串 / 空数组 也算空
  return keys.every((k) => {
    const v = payload[k];
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
}

/** 把 step N 的 payload 合并到 facts */
function mergePayloadIntoFacts(
  step: OnboardingStep,
  facts: OnboardingFacts,
  payload: Record<string, unknown>,
  cards: Array<{ id: string; tags: string[] }>,
): OnboardingFacts {
  const next: OnboardingFacts = { ...facts };
  switch (step) {
    case 1: {
      if (typeof payload.city === 'string' && payload.city) next.city = payload.city;
      break;
    }
    case 2: {
      if (typeof payload.intent === 'string' && payload.intent) next.intent = payload.intent;
      break;
    }
    case 3: {
      const parsed = parseSwipe(payload, cards);
      if (parsed.gender_pref) next.gender_pref = parsed.gender_pref;
      if (parsed.age_pref) next.age_pref = parsed.age_pref;
      if (parsed.style_pref) next.style_pref = parsed.style_pref;
      break;
    }
    case 4: {
      if (typeof payload.time_slot === 'string' && payload.time_slot) next.time_slot = payload.time_slot;
      if (typeof payload.language === 'string' && payload.language) next.language = payload.language;
      break;
    }
    case 5: {
      if (typeof payload.price_range === 'string' && payload.price_range)
        next.price_range = payload.price_range;
      if (typeof payload.privacy_mode === 'string' && payload.privacy_mode)
        next.privacy_mode = payload.privacy_mode;
      break;
    }
    case 6: {
      // step 6 payload 一般为 { engaged: true } 或 {} · 不抓字段
      break;
    }
  }
  return next;
}

/** 缺失字段用默认值兜底(跳到 6 时用)*/
function fillDefaults(facts: OnboardingFacts, locale: AssistantLocale): OnboardingFacts {
  return {
    city: facts.city ?? '',
    intent: facts.intent ?? 'relax',
    gender_pref: facts.gender_pref ?? 'female',
    age_pref: facts.age_pref ?? ['26-32'],
    style_pref: facts.style_pref ?? (locale === 'en' ? ['tender'] : ['温柔']),
    time_slot: facts.time_slot ?? 'flexible',
    language: facts.language ?? (locale === 'en' ? 'en' : 'zh'),
    price_range: facts.price_range ?? 'flexible',
    privacy_mode: facts.privacy_mode ?? 'codename',
  };
}

// ──────────────── 完成判定 F03-OB3 ────────────────

/**
 * 完成判定:
 *   1. 走到 step 6 且 picks 已生成(即调用方走完 step 6) → true
 *   2. 轮 3 完成(style/gender/age 任一) + city + 至少 1 个意图字段 → true
 */
function judgeComplete(facts: OnboardingFacts, atStep: OnboardingStep): boolean {
  if (atStep === 6) return true;
  const hasStyle3 =
    (Array.isArray(facts.style_pref) && facts.style_pref.length > 0) ||
    !!facts.gender_pref ||
    (Array.isArray(facts.age_pref) && facts.age_pref.length > 0);
  const hasCity = !!facts.city;
  const hasIntent = !!facts.intent || !!facts.time_slot;
  return hasStyle3 && hasCity && hasIntent && atStep >= 4;
}

// ──────────────── 主入口 ────────────────

export interface OnboardingStepArgs {
  step: OnboardingStep;
  payload: Record<string, unknown>;
}

export async function onboardingStep(
  ctx: OnboardingContext,
  gateway: LLMGateway,
  userId: string,
  args: OnboardingStepArgs,
  localeOverride?: AssistantLocale,
): Promise<OnboardingStepResult> {
  // 1. locale
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const locale = localeOverride ?? normalizeLocale(u?.locale);
  const s = script(locale);

  // 2. 读累计 facts
  const saved = await readSaved(ctx, userId);
  const progress = readProgress(saved);

  // 3. 解析 payload
  const skipped = isSkipped(args.payload);
  const empty = isEmpty(args.payload);

  // 4. 合并 payload(empty 时不改 facts)
  let nextFacts = progress.facts;
  if (!empty && !skipped) {
    nextFacts = mergePayloadIntoFacts(args.step, progress.facts, args.payload, s.styleSwipeCards());
  }

  // 5. 决定 next_step + emptyStreak
  let nextStep: NextStep;
  let nextEmptyStreak = progress.emptyStreak;
  let jumpReason: 'normal' | 'skipped' | 'empty_streak' = 'normal';

  if (skipped) {
    nextStep = args.step >= 6 ? 'done' : 6;
    nextEmptyStreak = 0;
    jumpReason = 'skipped';
  } else if (empty) {
    nextEmptyStreak = progress.emptyStreak + 1;
    if (nextEmptyStreak >= 2) {
      nextStep = args.step >= 6 ? 'done' : 6;
      jumpReason = 'empty_streak';
    } else {
      // 同步留在本步等待客户(返回相同 ai_reply 等再次输入)
      nextStep = args.step;
    }
  } else {
    nextEmptyStreak = 0;
    if (args.step >= 6) nextStep = 'done';
    else nextStep = (args.step + 1) as OnboardingStep;
  }

  // 6. 装首推(step 6 / done 时)
  let firstRec: OnboardingStepResult['first_recommendation'] | undefined;
  let aiReply: string;
  let visibleOptions: OnboardingStepResult['visible_options'] | undefined;
  let visibleSwipeCards: OnboardingStepResult['visible_swipe_cards'] | undefined;

  // 当我们要"离开"6 步剧本时(即即将进入 6 或 done),把默认值填上 + 出推荐
  const willShowStep6 = nextStep === 6 || nextStep === 'done';
  if (willShowStep6) {
    const filled = fillDefaults(nextFacts, locale);
    nextFacts = filled;

    // 拉推荐(失败 fallback 不阻塞)
    let picks: Awaited<ReturnType<typeof m03Recommend>> = [];
    try {
      picks = await m03Recommend(
        { db: ctx.db },
        gateway,
        {
          userId,
          city: filled.city || undefined,
          intent: filled.intent,
          topN: 3,
        },
      );
    } catch {
      picks = [];
    }

    firstRec = picks.map((p) => ({
      therapist_id: p.therapist.id,
      avatar_url: p.therapist.avatarUrl ?? null,
      service_city: p.therapist.serviceCity ?? null,
      rating: p.therapist.rating,
      online_status: p.therapist.onlineStatus,
      match_score: Number(p.weight.toFixed(2)),
      reason: p.reason,
    }));

    // 跳过 / 连续空 的开场用自嘲
    const preface =
      jumpReason === 'empty_streak' ? `${s.selfDeprecateSkip()} ` : '';
    aiReply = `${preface}${s.step6Reply(filled, firstRec.length)}`;
  } else if (nextStep === 1) {
    aiReply = s.step1Reply();
    visibleOptions = s.step1Options();
  } else if (nextStep === 2) {
    aiReply = s.step2Reply(nextFacts);
    visibleOptions = s.step2Options();
  } else if (nextStep === 3) {
    aiReply = s.step3Reply(nextFacts);
    visibleSwipeCards = s.styleSwipeCards();
  } else if (nextStep === 4) {
    aiReply = s.step4Reply(nextFacts);
    visibleOptions = [...s.step4TimeOptions(), ...s.step4LangOptions()];
  } else if (nextStep === 5) {
    aiReply = s.step5Reply(nextFacts);
    visibleOptions = [...s.step5PriceOptions(), ...s.step5PrivacyOptions()];
  } else {
    // 兜底
    aiReply = s.step1Reply();
  }

  // 7. 完成判定
  const completeNow =
    willShowStep6 ||
    progress.complete ||
    judgeComplete(nextFacts, args.step);

  // 8. 写回 progress(纯增量,不抹其它 facts)
  await writeProgress(ctx, userId, {
    facts: nextFacts,
    emptyStreak: nextEmptyStreak,
    lastStep: typeof nextStep === 'number' ? nextStep : 6,
    complete: completeNow,
  });

  // 完成时同步刷 stable_prefs + 预热 today_picks(不阻塞)
  if (completeNow) {
    await finalizeStablePrefs(ctx, userId, nextFacts);
    fireAndForget(
      primeTodayPicksAfterOnboarding(ctx, userId, { gateway, localeOverride: locale }),
      'onboarding.prime_picks',
    );
  }

  return {
    next_step: nextStep,
    ai_reply: aiReply,
    visible_options: visibleOptions,
    visible_swipe_cards: visibleSwipeCards,
    first_recommendation: firstRec,
  };
}

/** 给 home.ts 用:判定客户是否已完成 onboarding */
export async function isOnboardingComplete(
  ctx: OnboardingContext,
  userId: string,
): Promise<boolean> {
  const saved = await readSaved(ctx, userId);
  const raw = (saved?.facts ?? {}) as SavedFactsWithProgress;
  return Boolean(raw.onboarding_complete);
}

/** 重置 onboarding(测试 / 客户主动重新走) */
export async function resetOnboarding(
  ctx: OnboardingContext,
  userId: string,
): Promise<void> {
  const existing = await readSaved(ctx, userId);
  if (!existing) return;
  const existingFacts = (existing.facts ?? {}) as SavedFactsWithProgress;
  const patch: SavedFactsWithProgress = { ...existingFacts };
  delete patch.onboarding_progress;
  delete patch.onboarding_empty_streak;
  delete patch.onboarding_last_step;
  patch.onboarding_complete = false;
  await ctx.db
    .update(customerSavedMemory)
    .set({ facts: patch, updatedAt: new Date() })
    .where(eq(customerSavedMemory.userId, userId));
}
