/**
 * 9 步首见对话 onboarding 状态机 · 对齐 0522 信息采集表
 *
 * 入口:onboardingStep(ctx, userId, step, payload, locale)
 * 流程:
 *   1. 读 customer_saved_memory.facts.onboarding_progress(累计 facts)
 *   2. 把 payload 合并进 facts 字段
 *   3. 处理跳过/空 payload 异常(F03-OB2)
 *   4. 决定 next_step:
 *      - skipped=true → 跳 step 9(出推荐)
 *      - 连续 2 步空 payload → 跳 step 9 + 自嘲
 *      - 否则 step + 1(到 9 后 done)
 *   5. 生成 ai_reply(基于已采集字段动态填充)
 *   6. 返回 visible_options / visible_swipe_cards / first_recommendation(仅 step 9)
 *   7. 完成时 UPDATE customer_saved_memory · 设 onboarding_complete=true
 *
 * 跳过即代表"先看看" · 缺失字段用默认值兜底。
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

const TERMINAL_STEP: OnboardingStep = 9;

export interface OnboardingContext extends MemoryContext {
  db: Database;
}

export interface OnboardingStepResult {
  next_step: NextStep;
  ai_reply: string;
  visible_options?: Array<{ label: string; value: string; group?: string }>;
  visible_swipe_cards?: Array<{ id: string; img_url: string; tags: string[] }>;
  visible_textareas?: Array<{ name: string; label: string; placeholder: string; maxLength?: number }>;
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

function script(locale: AssistantLocale): typeof zh {
  return locale === 'en' ? (en as unknown as typeof zh) : zh;
}

// ──────────────── facts 读写 ────────────────

interface SavedFactsWithProgress {
  onboarding_progress?: OnboardingFacts;
  onboarding_empty_streak?: number;
  onboarding_last_step?: number;
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
    // 新增维度提升到顶层(供 compactSavedToSnippet + recommender 直接读)
    if (Array.isArray(patch.facts.primary_focus) && patch.facts.primary_focus.length)
      factsPatch.primary_focus = patch.facts.primary_focus;
    if (Array.isArray(patch.facts.look_style) && patch.facts.look_style.length)
      factsPatch.look_style = patch.facts.look_style;
    if (Array.isArray(patch.facts.age_pref) && patch.facts.age_pref.length)
      factsPatch.age_pref = patch.facts.age_pref;
    if (Array.isArray(patch.facts.height_pref) && patch.facts.height_pref.length)
      factsPatch.height_pref = patch.facts.height_pref;
    if (Array.isArray(patch.facts.body_type) && patch.facts.body_type.length)
      factsPatch.body_type = patch.facts.body_type;
    if (Array.isArray(patch.facts.bust_pref) && patch.facts.bust_pref.length)
      factsPatch.bust_pref = patch.facts.bust_pref;
    if (Array.isArray(patch.facts.service_style) && patch.facts.service_style.length)
      factsPatch.service_style = patch.facts.service_style;
    if (Array.isArray(patch.facts.service_strength) && patch.facts.service_strength.length)
      factsPatch.service_strength = patch.facts.service_strength;
    if (Array.isArray(patch.facts.nationality_pref) && patch.facts.nationality_pref.length)
      factsPatch.nationality_pref = patch.facts.nationality_pref;
    if (Array.isArray(patch.facts.service_area) && patch.facts.service_area.length)
      factsPatch.service_area = patch.facts.service_area;
    if (patch.facts.tip_band) factsPatch.tip_band = patch.facts.tip_band;
    if (patch.facts.likes_text) factsPatch.likes_text = patch.facts.likes_text;
    if (patch.facts.dislikes_text) factsPatch.dislikes_text = patch.facts.dislikes_text;
    if (patch.facts.self_intro) factsPatch.self_intro = patch.facts.self_intro;
  }
  await upsertSaved(ctx, userId, { facts: factsPatch });
}

async function finalizeStablePrefs(
  ctx: OnboardingContext,
  userId: string,
  facts: OnboardingFacts,
): Promise<void> {
  const stable: Record<string, unknown> = {};
  // priorities = 服务风格 + 颜值风格 合并(供旧 recommender 读)
  const priorities = [
    ...(Array.isArray(facts.look_style) ? facts.look_style : []),
    ...(Array.isArray(facts.service_style) ? facts.service_style : []),
  ].filter((s) => s && s !== 'any');
  if (priorities.length) stable.priorities = priorities;
  if (facts.price_range && facts.price_range !== 'flexible') stable.priceBand = facts.price_range;
  if (facts.privacy_mode) stable.privacyMode = facts.privacy_mode;
  // dislikes 自由文本(可被 LLM 进一步抽取)
  if (facts.dislikes_text) stable.dislikesText = facts.dislikes_text;
  if (Object.keys(stable).length) {
    await upsertSaved(ctx, userId, { stablePrefs: stable });
  }
}

// ──────────────── swipe 解析:cards 标签 → gender/age/look_style ────────────────

function parseSwipe(
  payload: SwipePayload,
  cards: Array<{ id: string; tags: string[] }>,
): { gender_pref?: string; age_pref?: string[]; look_style?: string[] } {
  const liked = new Set((payload.liked ?? []).map(String));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const genders = new Set<string>();
  const ages = new Set<string>();
  const looks = new Set<string>();

  for (const id of liked) {
    const c = cardById.get(id);
    if (!c) continue;
    for (const t of c.tags) {
      const [k, v] = t.split(':');
      if (!v) continue;
      if (k === 'gender') genders.add(v);
      else if (k === 'age') ages.add(v);
      else if (k === 'look' || k === 'style') looks.add(v);
    }
  }

  return {
    gender_pref: genders.size === 1 ? Array.from(genders)[0] : genders.size > 1 ? 'any' : undefined,
    age_pref: ages.size ? Array.from(ages) : undefined,
    look_style: looks.size ? Array.from(looks) : undefined,
  };
}

// ──────────────── payload 合并 ────────────────

function isSkipped(payload: Record<string, unknown> | undefined | null): boolean {
  if (!payload) return false;
  return payload.skipped === true || payload.skip === true;
}

function isEmpty(payload: Record<string, unknown> | undefined | null): boolean {
  if (!payload) return true;
  if (isSkipped(payload)) return false;
  const keys = Object.keys(payload).filter((k) => k !== 'skipped' && k !== 'skip');
  if (keys.length === 0) return true;
  return keys.every((k) => {
    const v = payload[k];
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
}

function strArr(v: unknown): string[] | undefined {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return undefined;
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
      else if (typeof payload.text === 'string' && payload.text) next.city = payload.text;
      else {
        const vals = strArr(payload.values);
        if (vals && vals.length) next.city = vals[0];
      }
      break;
    }
    case 2: {
      const vals = strArr(payload.values) ?? strArr(payload.primary_focus);
      if (vals) next.primary_focus = vals;
      break;
    }
    case 3: {
      const parsed = parseSwipe(payload as SwipePayload, cards);
      if (parsed.gender_pref) next.gender_pref = parsed.gender_pref;
      if (parsed.age_pref) next.age_pref = parsed.age_pref;
      if (parsed.look_style) next.look_style = parsed.look_style;
      break;
    }
    case 4: {
      const a = strArr(payload.age_pref);
      if (a) next.age_pref = a;
      const h = strArr(payload.height_pref);
      if (h) next.height_pref = h;
      const b = strArr(payload.body_type);
      if (b) next.body_type = b;
      const bu = strArr(payload.bust_pref);
      if (bu) next.bust_pref = bu;
      break;
    }
    case 5: {
      const ss = strArr(payload.service_style);
      if (ss) next.service_style = ss;
      const st = strArr(payload.service_strength);
      if (st) next.service_strength = st;
      break;
    }
    case 6: {
      const n = strArr(payload.nationality_pref);
      if (n) next.nationality_pref = n;
      if (typeof payload.language === 'string' && payload.language) next.language = payload.language;
      const ar = strArr(payload.service_area);
      if (ar) next.service_area = ar;
      break;
    }
    case 7: {
      if (typeof payload.price_range === 'string' && payload.price_range) next.price_range = payload.price_range;
      if (typeof payload.privacy_mode === 'string' && payload.privacy_mode) next.privacy_mode = payload.privacy_mode;
      if (typeof payload.tip_band === 'string' && payload.tip_band) next.tip_band = payload.tip_band;
      if (typeof payload.time_slot === 'string' && payload.time_slot) next.time_slot = payload.time_slot;
      break;
    }
    case 8: {
      if (typeof payload.likes_text === 'string') next.likes_text = payload.likes_text.slice(0, 500);
      if (typeof payload.dislikes_text === 'string') next.dislikes_text = payload.dislikes_text.slice(0, 500);
      break;
    }
    case 9: {
      if (typeof payload.self_intro === 'string') next.self_intro = payload.self_intro.slice(0, 800);
      break;
    }
  }
  return next;
}

/** 缺失字段用默认值兜底(跳到 9 时用)*/
function fillDefaults(facts: OnboardingFacts, locale: AssistantLocale): OnboardingFacts {
  return {
    ...facts,
    city: facts.city ?? '',
    primary_focus: facts.primary_focus ?? ['any'],
    gender_pref: facts.gender_pref ?? 'female',
    age_pref: facts.age_pref ?? ['any'],
    look_style: facts.look_style ?? [],
    height_pref: facts.height_pref ?? ['any'],
    body_type: facts.body_type ?? ['any'],
    bust_pref: facts.bust_pref ?? ['any'],
    service_style: facts.service_style ?? [],
    service_strength: facts.service_strength ?? ['按需调整'],
    nationality_pref: facts.nationality_pref ?? ['any'],
    language: facts.language ?? (locale === 'en' ? 'en' : 'zh'),
    service_area: facts.service_area ?? ['any'],
    price_range: facts.price_range ?? 'flexible',
    privacy_mode: facts.privacy_mode ?? 'codename',
    tip_band: facts.tip_band ?? 'none',
    time_slot: facts.time_slot ?? 'flexible',
    likes_text: facts.likes_text ?? '',
    dislikes_text: facts.dislikes_text ?? '',
    self_intro: facts.self_intro ?? '',
  };
}

// ──────────────── 完成判定 ────────────────

function judgeComplete(facts: OnboardingFacts, atStep: OnboardingStep): boolean {
  if (atStep >= TERMINAL_STEP) return true;
  // 核心字段 + 已到后段 = 完成(允许中途 skip)
  const hasCity = !!facts.city;
  const hasFocus = Array.isArray(facts.primary_focus) && facts.primary_focus.length > 0;
  const hasStyle =
    (Array.isArray(facts.look_style) && facts.look_style.length > 0) ||
    (Array.isArray(facts.service_style) && facts.service_style.length > 0) ||
    !!facts.gender_pref;
  return hasCity && hasFocus && hasStyle && atStep >= 7;
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
    nextStep = args.step >= TERMINAL_STEP ? 'done' : TERMINAL_STEP;
    nextEmptyStreak = 0;
    jumpReason = 'skipped';
  } else if (empty) {
    nextEmptyStreak = progress.emptyStreak + 1;
    if (nextEmptyStreak >= 2) {
      nextStep = args.step >= TERMINAL_STEP ? 'done' : TERMINAL_STEP;
      jumpReason = 'empty_streak';
    } else {
      nextStep = args.step;
    }
  } else {
    nextEmptyStreak = 0;
    if (args.step >= TERMINAL_STEP) nextStep = 'done';
    else nextStep = (args.step + 1) as OnboardingStep;
  }

  // 6. 装首推(step 9 / done 时)
  let firstRec: OnboardingStepResult['first_recommendation'] | undefined;
  let aiReply: string;
  let visibleOptions: OnboardingStepResult['visible_options'] | undefined;
  let visibleSwipeCards: OnboardingStepResult['visible_swipe_cards'] | undefined;
  let visibleTextareas: OnboardingStepResult['visible_textareas'] | undefined;

  const willShowDone = nextStep === TERMINAL_STEP || nextStep === 'done';
  if (willShowDone) {
    const filled = fillDefaults(nextFacts, locale);
    nextFacts = filled;

    let picks: Awaited<ReturnType<typeof m03Recommend>> = [];
    try {
      picks = await m03Recommend(
        { db: ctx.db },
        gateway,
        { userId, city: filled.city || undefined, intent: filled.intent, topN: 3 },
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

    const preface = jumpReason === 'empty_streak' ? `${s.selfDeprecateSkip()} ` : '';
    // step 9 是 self_intro + 出推荐 · ai_reply 兼顾两段
    aiReply = `${preface}${s.step9Reply(filled)}\n\n${s.step9DoneReply(filled, firstRec.length)}`;
    visibleTextareas = [
      { name: 'self_intro', label: '自我推荐', placeholder: s.step9IntroPlaceholder(), maxLength: 800 },
    ];
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
    visibleOptions = [
      ...s.step4AgeOptions().map((o) => ({ ...o, group: 'age_pref' })),
      ...s.step4HeightOptions().map((o) => ({ ...o, group: 'height_pref' })),
      ...s.step4BodyOptions().map((o) => ({ ...o, group: 'body_type' })),
      ...s.step4BustOptions().map((o) => ({ ...o, group: 'bust_pref' })),
    ];
  } else if (nextStep === 5) {
    aiReply = s.step5Reply(nextFacts);
    visibleOptions = [
      ...s.step5StyleOptions().map((o) => ({ ...o, group: 'service_style' })),
      ...s.step5StrengthOptions().map((o) => ({ ...o, group: 'service_strength' })),
    ];
  } else if (nextStep === 6) {
    aiReply = s.step6Reply(nextFacts);
    visibleOptions = [
      ...s.step6NationOptions().map((o) => ({ ...o, group: 'nationality_pref' })),
      ...s.step6LangOptions().map((o) => ({ ...o, group: 'language' })),
      ...s.step6AreaOptions().map((o) => ({ ...o, group: 'service_area' })),
    ];
  } else if (nextStep === 7) {
    aiReply = s.step7Reply(nextFacts);
    visibleOptions = [
      ...s.step7PriceOptions().map((o) => ({ ...o, group: 'price_range' })),
      ...s.step7PrivacyOptions().map((o) => ({ ...o, group: 'privacy_mode' })),
      ...s.step7TipOptions().map((o) => ({ ...o, group: 'tip_band' })),
      ...s.step7TimeOptions().map((o) => ({ ...o, group: 'time_slot' })),
    ];
  } else if (nextStep === 8) {
    aiReply = s.step8Reply(nextFacts);
    visibleTextareas = [
      { name: 'likes_text', label: '特别喜欢', placeholder: s.step8LikesPlaceholder(), maxLength: 500 },
      { name: 'dislikes_text', label: '特别讨厌', placeholder: s.step8DislikesPlaceholder(), maxLength: 500 },
    ];
  } else {
    aiReply = s.step1Reply();
  }

  // 7. 完成判定
  const completeNow =
    willShowDone ||
    progress.complete ||
    judgeComplete(nextFacts, args.step);

  // 8. 写回 progress
  await writeProgress(ctx, userId, {
    facts: nextFacts,
    emptyStreak: nextEmptyStreak,
    lastStep: typeof nextStep === 'number' ? nextStep : TERMINAL_STEP,
    complete: completeNow,
  });

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
    visible_textareas: visibleTextareas,
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
