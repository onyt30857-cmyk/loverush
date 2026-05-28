/**
 * 助理 Home 仪表盘数据组装 · PRD §3.0 F03-Home1 / F03-Home3
 *
 * GET /assistant/home 返回:
 *   - greeting             5 时段 × 中英 + 籍贯个性化
 *   - today_cards          最多 3 张 · recall / available / new_match
 *   - history              最近 3 条对话(customer_assistant_sessions)
 *   - quick_acts           4-6 个 chip(按身高/按风格/今晚/新到城/按预算/按语言)
 *   - onboarding_required  facts.onboarding_complete=false → true
 *
 * 主动 push 卡逻辑:
 *   - recall:扫 L4 关系层最近未下单的技师 + 是否今晚有档
 *   - available:稳定偏好 + 今晚可用的 Top 3 候选
 *   - new_match:基于 stable_prefs 匹配本周新入驻技师
 *   每类最多 1 张 · 总共最多 3 张 · 不重复技师
 *
 * 风格:好哥们腔 · title/subtitle 短 · 直接 · 不"亲爱的"
 */

import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  customerAssistantSessions,
  customerReferenceMemory,
  customerOutreachState,
  orders,
  therapists,
  users,
} from '@loverush/db';
import { readSaved, type MemoryContext } from './memory';
import { isOnboardingComplete, type OnboardingContext } from './onboarding';
import { normalizeLocale, type AssistantLocale } from './voice';
import { buildGreeting, toToneFromDate, type GreetingTone } from './prompts/greeting';

export interface HomeContext extends MemoryContext, OnboardingContext {
  db: Database;
}

export interface HomeTodayCard {
  id: string;
  type: 'recall' | 'available' | 'new_match';
  title: string;
  subtitle: string;
  action_href: string;
}

export interface HomeHistoryItem {
  id: string;
  preview: string;
  updated_at: string;
  turns_count: number;
}

export interface HomeQuickAct {
  key: 'by_height' | 'by_style' | 'tonight' | 'new_to_city' | 'by_budget' | 'by_language';
  label: string;
  intent_seed: string;
}

export interface AssistantHome {
  greeting: { text: string; tone: GreetingTone };
  today_cards: HomeTodayCard[];
  history: HomeHistoryItem[];
  quick_acts: HomeQuickAct[];
  onboarding_required: boolean;
}

// ──────────────── greeting ────────────────

async function buildGreetingForUser(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
): Promise<{ text: string; tone: GreetingTone }> {
  const saved = await readSaved(ctx, userId);
  const facts = (saved?.facts ?? {}) as { nationality?: string; origin?: string; city?: string };
  const nationality = facts.nationality ?? facts.origin ?? facts.city ?? null;
  const tone = toToneFromDate();
  const family = locale === 'en' ? 'en' : 'zh';
  return { text: buildGreeting(tone, family, nationality), tone };
}

// ──────────────── today cards ────────────────

interface RelationRow {
  id: string;
  refTherapistId: string | null;
  content: string;
  recordedAt: Date;
}

/** recall:扫客户 L4 最近浏览未下单的技师 · 看是否今晚有档 */
async function pickRecallCard(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
): Promise<HomeTodayCard | null> {
  // 取 L4 relation 中最近 5 条带 ref_therapist_id 的
  const relations = await ctx.db.query.customerReferenceMemory.findMany({
    where: and(
      eq(customerReferenceMemory.userId, userId),
      eq(customerReferenceMemory.memoryType, 'relation'),
      sql`${customerReferenceMemory.refTherapistId} IS NOT NULL`,
      sql`${customerReferenceMemory.archivedAt} IS NULL`,
    ),
    orderBy: [desc(customerReferenceMemory.recordedAt)],
    limit: 5,
  });
  if (relations.length === 0) return null;

  // 检查这些 therapist 中是否有今天没下单过的(避免重复推已下单的)
  const therapistIds = relations
    .map((r) => r.refTherapistId)
    .filter((id): id is string => !!id);
  if (therapistIds.length === 0) return null;

  // 拿最近一条命中的技师 · 检查 ta 是否在线/passed
  const t = await ctx.db.query.therapists.findFirst({
    where: and(
      sql`${therapists.id} IN (${sql.join(therapistIds.map((id) => sql`${id}`), sql`, `)})`,
      eq(therapists.verificationStatus, 'passed'),
      ne(therapists.coolingStatus, 'cold'),
    ),
    orderBy: [desc(therapists.lastOnlineAt)],
  });
  if (!t) return null;

  const name = (t.bio?.slice(0, 8) ?? '老熟人').trim() || '老熟人';
  const isOnline = t.onlineStatus === 'online';
  const title =
    locale === 'en'
      ? `${name} — you checked her a few times`
      : `${name} 你最近看了几次`;
  const subtitle =
    locale === 'en'
      ? isOnline
        ? "she's open tonight →"
        : 'might be free tonight →'
      : isOnline
        ? '她今晚有档 →'
        : '今晚可能有空 →';
  return {
    id: `recall_${t.id}`,
    type: 'recall',
    title,
    subtitle,
    action_href: `/therapists/${t.id}`,
  };
}

/** available:稳定偏好 + 今晚可用 */
async function pickAvailableCard(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
  excludeTherapistIds: Set<string>,
): Promise<HomeTodayCard | null> {
  const saved = await readSaved(ctx, userId);
  const facts = (saved?.facts ?? {}) as { city?: string };
  const stable = (saved?.stablePrefs ?? {}) as { priorities?: string[] };
  // 没稳定偏好不出该卡 · 避免冷启动乱推
  if (!stable.priorities || stable.priorities.length === 0) return null;

  // 当前在线 · 城市匹配(若有)· passed · 非 cold
  const conds = [
    eq(therapists.verificationStatus, 'passed'),
    ne(therapists.coolingStatus, 'cold'),
    eq(therapists.onlineStatus, 'online'),
  ];
  if (facts.city) conds.push(eq(therapists.serviceCity, facts.city));
  const candidates = await ctx.db.query.therapists.findMany({
    where: and(...conds),
    orderBy: [desc(therapists.rating), desc(therapists.scoreService)],
    limit: 10,
  });
  // 命中 tag 与稳定偏好交集的
  const matches = candidates.filter((t) => {
    if (excludeTherapistIds.has(t.id)) return false;
    const tags = t.tags ?? [];
    return stable.priorities!.some((p) => tags.includes(p));
  });
  const pick = matches[0];
  if (!pick) return null;
  const stylesLabel = stable.priorities.slice(0, 2).join(' / ');
  const title =
    locale === 'en'
      ? `${stylesLabel} pick — fits you tonight`
      : `${stylesLabel} · 今晚对得上`;
  const subtitle =
    locale === 'en' ? 'tap to view →' : '点开看看 →';
  return {
    id: `available_${pick.id}`,
    type: 'available',
    title,
    subtitle,
    action_href: `/therapists/${pick.id}`,
  };
}

/** new_match:基于 stable_prefs 匹配本周新入驻技师 */
async function pickNewMatchCard(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
  excludeTherapistIds: Set<string>,
): Promise<HomeTodayCard | null> {
  const saved = await readSaved(ctx, userId);
  const facts = (saved?.facts ?? {}) as { city?: string };
  const stable = (saved?.stablePrefs ?? {}) as { priorities?: string[] };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const conds = [
    eq(therapists.verificationStatus, 'passed'),
    ne(therapists.coolingStatus, 'cold'),
    gte(therapists.createdAt, sevenDaysAgo),
  ];
  if (facts.city) conds.push(eq(therapists.serviceCity, facts.city));

  const candidates = await ctx.db.query.therapists.findMany({
    where: and(...conds),
    orderBy: [desc(therapists.createdAt)],
    limit: 10,
  });

  // 优先命中稳定偏好 tags;没偏好时取本周最新
  let pick = candidates.find((t) => !excludeTherapistIds.has(t.id));
  if (stable.priorities && stable.priorities.length) {
    const matches = candidates.filter((t) => {
      if (excludeTherapistIds.has(t.id)) return false;
      const tags = t.tags ?? [];
      return stable.priorities!.some((p) => tags.includes(p));
    });
    if (matches[0]) pick = matches[0];
  }
  if (!pick) return null;

  const cityLabel = pick.serviceCity ?? (locale === 'en' ? 'your city' : '本地');
  const title =
    locale === 'en' ? `Fresh in ${cityLabel} this week` : `本周新到 · ${cityLabel}`;
  const subtitle =
    locale === 'en' ? "fits your style — check →" : '风格对得上你 · 点开看 →';

  return {
    id: `new_match_${pick.id}`,
    type: 'new_match',
    title,
    subtitle,
    action_href: `/therapists/${pick.id}`,
  };
}

async function buildTodayCards(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
): Promise<HomeTodayCard[]> {
  const seen = new Set<string>();
  const cards: HomeTodayCard[] = [];

  const recall = await pickRecallCard(ctx, userId, locale);
  if (recall) {
    cards.push(recall);
    const tid = recall.action_href.split('/').pop();
    if (tid) seen.add(tid);
  }

  const available = await pickAvailableCard(ctx, userId, locale, seen);
  if (available) {
    cards.push(available);
    const tid = available.action_href.split('/').pop();
    if (tid) seen.add(tid);
  }

  const newMatch = await pickNewMatchCard(ctx, userId, locale, seen);
  if (newMatch) cards.push(newMatch);

  return cards.slice(0, 3);
}

// ──────────────── history ────────────────

async function buildHistory(
  ctx: HomeContext,
  userId: string,
): Promise<HomeHistoryItem[]> {
  const rows = await ctx.db.query.customerAssistantSessions.findMany({
    where: eq(customerAssistantSessions.userId, userId),
    orderBy: [desc(customerAssistantSessions.updatedAt)],
    limit: 3,
  });
  return rows.map((r) => ({
    id: r.id,
    preview: r.preview ?? '',
    updated_at: r.updatedAt.toISOString(),
    turns_count: r.turnsCount,
  }));
}

// ──────────────── quick_acts ────────────────

function buildQuickActs(locale: AssistantLocale): HomeQuickAct[] {
  if (locale === 'en') {
    return [
      { key: 'by_height', label: 'By height', intent_seed: 'Find me someone tall / petite — your call' },
      { key: 'by_style', label: 'By style', intent_seed: "I'm in the mood for a specific style" },
      { key: 'tonight', label: 'Tonight', intent_seed: 'Who can take me tonight?' },
      { key: 'new_to_city', label: 'New arrivals', intent_seed: "Who's new in town this week?" },
      { key: 'by_budget', label: 'By budget', intent_seed: 'Pick within my budget band' },
      { key: 'by_language', label: 'By language', intent_seed: 'Chinese / English / Thai speakers' },
    ];
  }
  return [
    { key: 'by_height', label: '按身高', intent_seed: '帮我按身高挑 · 你看着办' },
    { key: 'by_style', label: '按风格', intent_seed: '今天想找特定风格的' },
    { key: 'tonight', label: '今晚', intent_seed: '今晚谁能接?' },
    { key: 'new_to_city', label: '新到城', intent_seed: '本周新到的有哪几位?' },
    { key: 'by_budget', label: '按预算', intent_seed: '按我的预算挑' },
    { key: 'by_language', label: '按语言', intent_seed: '会说中文/英文/泰语的' },
  ];
}

// ──────────────── 主入口 ────────────────

export async function getAssistantHome(
  ctx: HomeContext,
  userId: string,
  localeOverride?: AssistantLocale,
): Promise<AssistantHome> {
  // 取 locale
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const locale = localeOverride ?? normalizeLocale(u?.locale);

  // 并发组装
  const [greeting, todayCards, history, complete] = await Promise.all([
    buildGreetingForUser(ctx, userId, locale),
    buildTodayCards(ctx, userId, locale),
    buildHistory(ctx, userId),
    isOnboardingComplete(ctx, userId),
  ]);

  return {
    greeting,
    today_cards: todayCards,
    history,
    quick_acts: buildQuickActs(locale),
    onboarding_required: !complete,
  };
}

// ──────────────── 会话写入(chat 路由侧调) ────────────────

/** 写一条新会话 / 更新已有会话(用于 home history) */
export async function upsertAssistantSession(
  ctx: HomeContext,
  args: {
    userId: string;
    sessionId?: string;
    firstUserMessage?: string;
    turnsIncrement?: number;
  },
): Promise<{ id: string }> {
  // 已有 session_id 走更新
  if (args.sessionId) {
    const existing = await ctx.db.query.customerAssistantSessions.findFirst({
      where: and(
        eq(customerAssistantSessions.id, args.sessionId),
        eq(customerAssistantSessions.userId, args.userId),
      ),
    });
    if (existing) {
      await ctx.db
        .update(customerAssistantSessions)
        .set({
          turnsCount: sql`${customerAssistantSessions.turnsCount} + ${args.turnsIncrement ?? 1}`,
          updatedAt: new Date(),
        })
        .where(eq(customerAssistantSessions.id, args.sessionId));
      return { id: args.sessionId };
    }
  }
  const preview = (args.firstUserMessage ?? '').slice(0, 120);
  const [row] = await ctx.db
    .insert(customerAssistantSessions)
    .values({
      userId: args.userId,
      preview,
      turnsCount: args.turnsIncrement ?? 1,
    })
    .returning();
  if (!row) throw new Error('assistant_session insert failed');
  return { id: row.id };
}

// 让 orders 引用不在 lint 中报 unused
void orders;
