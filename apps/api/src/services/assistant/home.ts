/**
 * 助理 Home 仪表盘数据组装 · M03 v3 (PRD §3.0 v3 修订 2026-05-29)
 *
 * GET /assistant/home → 6 区块契约:
 *   1. greeting          时段 + 天数 + L1 籍贯 + tone
 *   2. memory_cta        跨次记忆 + 主动 CTA 合一卡(新用户 null)
 *   3. today_picks       今晚 3 张推荐 (永不空 · 编辑内容池兜底)
 *   4. recent_activity   最近活动 4 类(booking/question/favorite/view)
 *   5. smart_chips       默认 + 老客个性化("像 Mira 那种")
 *   6. onboarding_required
 *
 * POST /assistant/home/refresh-picks → 换一批 today_picks(排除最近用过的)
 *
 * 兜底铁律:
 *   - today_picks 永远 ≥ 3 张 (recommender 空 → 当日 seed 随机选 verified passed 技师)
 *   - memory_cta 新用户隐藏(返 null)
 *   - recent_activity 新用户返 []
 *
 * 风格:好哥们腔 · title/subtitle 短 · 直接 · 不"亲爱的"
 */

import { and, desc, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import type { LLMGateway } from '@loverush/llm';
import type { Database, Therapist } from '@loverush/db';
import {
  customerAssistantSessions,
  customerReferenceMemory,
  customerOutreachState,
  orders,
  therapists,
  users,
} from '@loverush/db';
import { readSaved, readReference, type MemoryContext } from './memory';
import { isOnboardingComplete, type OnboardingContext } from './onboarding';
import { recommend as m03Recommend } from './recommender';
import { normalizeLocale, type AssistantLocale } from './voice';
import { buildGreeting, toToneFromDate, type GreetingTone } from './prompts/greeting';

export interface HomeContext extends MemoryContext, OnboardingContext {
  db: Database;
}

// ──────────────── v3 类型 ────────────────

export interface HomeGreeting {
  text: string;
  tone: GreetingTone;
  days_since_first?: number;
}

export interface MemoryCtaAction {
  key: 'book_again' | 'try_another' | 'just_chat';
  label: string;
  ref_id?: string;
}

export type MemoryCtaType = 'recall_last_booking' | 'recall_last_chat' | 'first_visit';

export interface HomeMemoryCta {
  type: MemoryCtaType;
  headline: string;
  sub: string;
  actions: MemoryCtaAction[];
}

export interface HomePickItem {
  therapist_id: string;
  display_name: string;
  avatar_url: string | null;
  score_service: number; // 4.x(对外 / 100 后)
  distance_km: number | null;
  next_slot: string | null;
  tags: string[];
  why_recommend: string;
}

/**
 * 3 种场景:
 *   - 'ok'        正常返回 N 张真技师卡
 *   - 'no_match'  数据库真没 verified 技师匹配(运营要 seed)
 *   - 'preparing' 临时不可用(数据库挂 / 查询出错)· 前端可重试
 */
export type HomeTodayPicksStatus = 'ok' | 'no_match' | 'preparing';

export interface HomeTodayPicks {
  status: HomeTodayPicksStatus;
  reason_tag: string;
  items: HomePickItem[];
  refresh_token: string;
}

export interface HomeRecentActivity {
  type: 'booking' | 'question' | 'favorite' | 'view';
  date: string;
  summary: string;
  related_therapist_id?: string;
}

export interface HomeSmartChip {
  key: string;
  label: string;
  intent_seed: string;
}

export interface AssistantHome {
  greeting: HomeGreeting;
  memory_cta: HomeMemoryCta | null;
  today_picks: HomeTodayPicks;
  recent_activity: HomeRecentActivity[];
  smart_chips: HomeSmartChip[];
  onboarding_required: boolean;
}

// ──────────────── 兜底 / 缓存 ────────────────

/** 进程级 picks 排除缓存 · 每用户最近 10 个 therapistId · 用于 refresh-picks 去重 */
const recentPickExcludes = new Map<string, string[]>();

function pushExclude(userId: string, ids: string[]): void {
  const prev = recentPickExcludes.get(userId) ?? [];
  const merged = [...ids, ...prev].slice(0, 30);
  recentPickExcludes.set(userId, Array.from(new Set(merged)).slice(0, 30));
}

function readExclude(userId: string): Set<string> {
  return new Set(recentPickExcludes.get(userId) ?? []);
}

function genRefreshToken(): string {
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 当日稳定 seed · 同一天同一序列 */
function todaySeed(): number {
  return Math.floor(Date.now() / (24 * 3600 * 1000));
}

/** seeded shuffle · 同 seed 同序 */
function seededPick<T>(arr: T[], n: number, seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a.slice(0, n);
}

// ──────────────── greeting ────────────────

async function buildGreetingForUser(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
  user: { displayName?: string | null; createdAt?: Date | null } | null,
): Promise<HomeGreeting> {
  const saved = await readSaved(ctx, userId);
  const facts = (saved?.facts ?? {}) as {
    nationality?: string;
    origin?: string;
    city?: string;
  };
  const nationality = facts.nationality ?? facts.origin ?? facts.city ?? null;
  const tone = toToneFromDate();
  const family = locale === 'en' ? 'en' : 'zh';
  let text = buildGreeting(tone, family, nationality);

  // 第 N 天 信任货币
  let daysSinceFirst: number | undefined;
  if (user?.createdAt) {
    const ms = Date.now() - new Date(user.createdAt).getTime();
    const days = Math.max(1, Math.floor(ms / (24 * 3600 * 1000)) + 1);
    daysSinceFirst = days;
    // 名字 + 天数注入(PRD 第 23 天 样例)
    const name = (user.displayName ?? '').trim();
    if (locale === 'en') {
      const namePart = name ? ` ${name}` : '';
      text = `${text}${namePart} · day ${days}`;
    } else {
      const namePart = name ? ` ${name}` : '';
      text = `${text}${namePart} · 第 ${days} 天`;
    }
  }

  return { text, tone, days_since_first: daysSinceFirst };
}

// ──────────────── memory_cta ────────────────

/** 简化的"今晚有空"判断 · 不依赖排班表 */
function nextSlotForTherapist(t: Therapist, locale: AssistantLocale): string | null {
  if (t.onlineStatus === 'online') {
    return locale === 'en' ? 'tonight 22:00 open' : '22:00 空';
  }
  if (t.onlineStatus === 'away') {
    return locale === 'en' ? 'tonight 22:30 open' : '22:30 空';
  }
  return null;
}

/** L4 最近一次 booking 命中:type=relation + ref_order_id 非空 + content 包含好评信号 */
async function pickRecallLastBooking(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
): Promise<HomeMemoryCta | null> {
  // 取 L4 relation 最近 10 条带 order
  const rows = await ctx.db.query.customerReferenceMemory.findMany({
    where: and(
      eq(customerReferenceMemory.userId, userId),
      eq(customerReferenceMemory.memoryType, 'relation'),
      sql`${customerReferenceMemory.refTherapistId} IS NOT NULL`,
      isNull(customerReferenceMemory.archivedAt),
    ),
    orderBy: [desc(customerReferenceMemory.recordedAt)],
    limit: 10,
  });
  if (!rows.length) return null;

  // 优先:含 ref_order_id 的 + content 暗示好评(包含 还行/不错/手法/喜欢/good/nice/4|5 星)
  const goodRegex = /(还行|不错|喜欢|手法|舒服|好评|4|5|nice|good|great|loved)/i;
  let hit = rows.find((r) => r.refOrderId && goodRegex.test(r.content));
  if (!hit) hit = rows.find((r) => r.refOrderId) ?? rows[0];
  if (!hit?.refTherapistId) return null;

  // 拿技师
  const t = await ctx.db.query.therapists.findFirst({
    where: and(
      eq(therapists.id, hit.refTherapistId),
      eq(therapists.verificationStatus, 'passed'),
      ne(therapists.coolingStatus, 'cold'),
    ),
  });
  if (!t) return null;

  // 拼 display_name
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
  const name = (u?.displayName ?? (t.bio ?? '').slice(0, 8)).trim() || '熟人';

  const slot = nextSlotForTherapist(t, locale);
  const fragment = (hit.content ?? '').slice(0, 16);

  if (locale === 'en') {
    return {
      type: 'recall_last_booking',
      headline: `Back? Last time with ${name} you said "${fragment}"`,
      sub: slot ? `She's ${slot} tonight · go again?` : 'Maybe try her again?',
      actions: [
        { key: 'book_again', label: `Book ${name}`, ref_id: t.id },
        { key: 'try_another', label: 'Try another', ref_id: t.id },
        { key: 'just_chat', label: 'Just chat' },
      ],
    };
  }
  return {
    type: 'recall_last_booking',
    headline: `回来啦 · 上次约 ${name} 你说"${fragment}"`,
    sub: slot ? `今晚她 ${slot} · 要再来一次?` : '要再来一次?',
    actions: [
      { key: 'book_again', label: `约 ${name}`, ref_id: t.id },
      { key: 'try_another', label: '换个人', ref_id: t.id },
      { key: 'just_chat', label: '先聊聊' },
    ],
  };
}

/** L4 relation 中最近 chat 引用过的技师 · 退化 cta */
async function pickRecallLastChat(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
): Promise<HomeMemoryCta | null> {
  const rows = await ctx.db.query.customerReferenceMemory.findMany({
    where: and(
      eq(customerReferenceMemory.userId, userId),
      eq(customerReferenceMemory.memoryType, 'relation'),
      sql`${customerReferenceMemory.refTherapistId} IS NOT NULL`,
      isNull(customerReferenceMemory.archivedAt),
    ),
    orderBy: [desc(customerReferenceMemory.recordedAt)],
    limit: 5,
  });
  if (!rows.length) return null;
  const hit = rows[0]!;
  if (!hit.refTherapistId) return null;
  const t = await ctx.db.query.therapists.findFirst({
    where: and(
      eq(therapists.id, hit.refTherapistId),
      eq(therapists.verificationStatus, 'passed'),
    ),
  });
  if (!t) return null;
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
  const name = (u?.displayName ?? (t.bio ?? '').slice(0, 8)).trim() || '熟人';
  const slot = nextSlotForTherapist(t, locale);
  if (locale === 'en') {
    return {
      type: 'recall_last_chat',
      headline: `Remember ${name}? You looked her up`,
      sub: slot ? `${slot} tonight` : 'Want to take another look?',
      actions: [
        { key: 'book_again', label: `Book ${name}`, ref_id: t.id },
        { key: 'try_another', label: 'Try another' },
        { key: 'just_chat', label: 'Just chat' },
      ],
    };
  }
  return {
    type: 'recall_last_chat',
    headline: `${name} · 你之前看过`,
    sub: slot ? `今晚 ${slot}` : '要不要再看看?',
    actions: [
      { key: 'book_again', label: `约 ${name}`, ref_id: t.id },
      { key: 'try_another', label: '换个人' },
      { key: 'just_chat', label: '先聊聊' },
    ],
  };
}

async function buildMemoryCta(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
  isNewUser: boolean,
): Promise<HomeMemoryCta | null> {
  if (isNewUser) return null;
  const booking = await pickRecallLastBooking(ctx, userId, locale);
  if (booking) return booking;
  const chat = await pickRecallLastChat(ctx, userId, locale);
  return chat;
}

// ──────────────── today_picks ────────────────

const REASON_FALLBACK_ZH = '今晚平台精选';
const REASON_FALLBACK_EN = "tonight's editor pick";

/** 把 Therapist + user display name 包成 HomePickItem */
async function toPickItem(
  ctx: HomeContext,
  t: Therapist,
  locale: AssistantLocale,
  whyOverride?: string,
): Promise<HomePickItem> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
  const displayName = (u?.displayName ?? '').trim() || (t.bio ?? '').slice(0, 8) || '技师';
  const tags = (t.tags ?? []).slice(0, 4);
  const slot = nextSlotForTherapist(t, locale);
  return {
    therapist_id: t.id,
    display_name: displayName,
    avatar_url: t.avatarUrl ?? null,
    score_service: Math.round((t.scoreService ?? 0) / 10) / 10, // 0-1000 → 0-10
    distance_km: null,
    next_slot: slot,
    tags,
    why_recommend:
      whyOverride ?? (locale === 'en' ? REASON_FALLBACK_EN : REASON_FALLBACK_ZH),
  };
}

/** 兜底:查 verified passed 在线/活跃技师 · 当日 seed 选 N 个 */
async function fallbackPicks(
  ctx: HomeContext,
  locale: AssistantLocale,
  excludeIds: Set<string>,
  n: number,
  city?: string,
  seedOffset = 0,
): Promise<HomePickItem[]> {
  const conds = [
    eq(therapists.verificationStatus, 'passed'),
    ne(therapists.coolingStatus, 'cold'),
  ];
  if (city) conds.push(eq(therapists.serviceCity, city));
  const rows = await ctx.db.query.therapists.findMany({
    where: and(...conds),
    orderBy: [desc(therapists.scoreService), desc(therapists.rating)],
    limit: 30,
  });
  const filtered = rows.filter((t) => !excludeIds.has(t.id));
  if (filtered.length === 0) {
    // 极限兜底:不要求 city · 不排除 · 拿任何 passed
    const wider = await ctx.db.query.therapists.findMany({
      where: and(
        eq(therapists.verificationStatus, 'passed'),
        ne(therapists.coolingStatus, 'cold'),
      ),
      orderBy: [desc(therapists.scoreService)],
      limit: 10,
    });
    const picked = seededPick(wider, n, todaySeed() + seedOffset);
    return Promise.all(picked.map((t) => toPickItem(ctx, t, locale)));
  }
  const picked = seededPick(filtered, n, todaySeed() + seedOffset);
  return Promise.all(picked.map((t) => toPickItem(ctx, t, locale)));
}

async function buildTodayPicks(
  ctx: HomeContext,
  gateway: LLMGateway | null,
  userId: string,
  locale: AssistantLocale,
  options: {
    excludeIds?: Set<string>;
    seedOffset?: number;
    isNewUser: boolean;
    city?: string;
  },
): Promise<HomeTodayPicks> {
  try {
    return await buildTodayPicksUnsafe(ctx, gateway, userId, locale, options);
  } catch {
    // 数据库挂 / 查询超时 → 'preparing' · 前端可重试
    return {
      status: 'preparing',
      reason_tag: locale === 'en' ? 'Hold on, picking for you' : '正在为你挑 · 一会儿来看',
      items: [],
      refresh_token: genRefreshToken(),
    };
  }
}

async function buildTodayPicksUnsafe(
  ctx: HomeContext,
  gateway: LLMGateway | null,
  userId: string,
  locale: AssistantLocale,
  options: {
    excludeIds?: Set<string>;
    seedOffset?: number;
    isNewUser: boolean;
    city?: string;
  },
): Promise<HomeTodayPicks> {
  const exclude = options.excludeIds ?? new Set<string>();
  const n = 3;

  // 1. 优先调 recommender(老用户才用 LLM 生成 why)
  let recoItems: HomePickItem[] = [];
  if (!options.isNewUser && gateway) {
    try {
      const reco = await m03Recommend({ db: ctx.db }, gateway, {
        userId,
        city: options.city,
        topN: 5,
      });
      const fresh = reco.filter((r) => !exclude.has(r.therapist.id)).slice(0, n);
      recoItems = await Promise.all(
        fresh.map(async (r) => {
          const item = await toPickItem(ctx, r.therapist, locale, r.reason || undefined);
          return item;
        }),
      );
    } catch {
      recoItems = [];
    }
  }

  // 2. 不足 3 个 → 兜底补
  let items = recoItems;
  if (items.length < n) {
    const remainExclude = new Set<string>([
      ...exclude,
      ...items.map((i) => i.therapist_id),
    ]);
    const fallback = await fallbackPicks(
      ctx,
      locale,
      remainExclude,
      n - items.length,
      options.city,
      options.seedOffset ?? 0,
    );
    items = [...items, ...fallback];
  }

  // 3. 计算 status
  let status: HomeTodayPicksStatus;
  if (items.length >= n) {
    status = 'ok';
  } else if (items.length > 0) {
    // 拿到一些但不足 N · 仍 ok(前端显示拿到的)
    status = 'ok';
  } else {
    // 完全没拿到 · 判定是真无匹配还是数据问题
    // 兜底已包含极限 fallback(不带 city 不过滤),仍空 = 数据库真没 verified 技师
    status = 'no_match';
  }

  // 4. reason_tag
  const reasonTag = computeReasonTag(items, options.isNewUser, locale);

  // 5. 记 refresh exclude(后端进程内 · 不持久化)
  pushExclude(userId, items.map((i) => i.therapist_id));

  return {
    status,
    reason_tag: reasonTag,
    items,
    refresh_token: genRefreshToken(),
  };
}

function computeReasonTag(
  items: HomePickItem[],
  isNewUser: boolean,
  locale: AssistantLocale,
): string {
  if (isNewUser) {
    return locale === 'en' ? "tonight's editor picks" : '今晚平台精选';
  }
  // 取 items 第一个的 tags[0] 做"基于你常选的 X"
  const firstTag = items[0]?.tags[0];
  if (firstTag) {
    return locale === 'en' ? `based on your style: ${firstTag}` : `基于你常选的${firstTag}`;
  }
  return locale === 'en' ? "tonight's editor picks" : '今晚平台精选';
}

// ──────────────── recent_activity ────────────────

async function buildRecentActivity(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
  isNewUser: boolean,
): Promise<HomeRecentActivity[]> {
  if (isNewUser) return [];

  const out: HomeRecentActivity[] = [];

  // 1. booking · 从 orders COMPLETED 取最近 3 条
  try {
    const bookings = await ctx.db.query.orders.findMany({
      where: and(
        eq(orders.customerId, userId),
        eq(orders.status, 'COMPLETED'),
      ),
      orderBy: [desc(orders.completedAt)],
      limit: 3,
    });
    for (const b of bookings) {
      const when = b.completedAt ?? b.createdAt;
      const rating = b.customerRating;
      const review = (b.customerReview ?? '').slice(0, 12);
      // 拿技师 name
      const t = await ctx.db.query.therapists.findFirst({
        where: eq(therapists.id, b.therapistId),
      });
      let name = '';
      if (t) {
        const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
        name = (u?.displayName ?? (t.bio ?? '').slice(0, 8)).trim() || '';
      }
      const summary =
        locale === 'en'
          ? `Booked ${name || 'her'}${rating ? ` ★${rating}` : ''}${review ? ` "${review}"` : ''}`
          : `约了 ${name || '她'}${rating ? ` ★${rating}` : ''}${review ? ` "${review}"` : ''}`;
      out.push({
        type: 'booking',
        date: when.toISOString(),
        summary,
        related_therapist_id: b.therapistId,
      });
    }
  } catch {
    // 忽略 · 不阻塞
  }

  // 2. question · 从 customer_assistant_sessions 取最近 3 条 preview
  try {
    const sessions = await ctx.db.query.customerAssistantSessions.findMany({
      where: eq(customerAssistantSessions.userId, userId),
      orderBy: [desc(customerAssistantSessions.updatedAt)],
      limit: 3,
    });
    for (const s of sessions) {
      if (!s.preview) continue;
      const summary =
        locale === 'en'
          ? `You asked "${s.preview.slice(0, 24)}"`
          : `你问"${s.preview.slice(0, 24)}"`;
      out.push({
        type: 'question',
        date: s.updatedAt.toISOString(),
        summary,
      });
    }
  } catch {
    // 忽略
  }

  // 3. favorite · 从 L3 rotating + L4 relation 中 entities 含 favorite/收藏
  try {
    const rot = await readReference(ctx, userId, 'rotating', 5);
    const rel = await readReference(ctx, userId, 'relation', 5);
    for (const r of [...rot, ...rel]) {
      const ents = r.entities ?? [];
      if (ents.some((e: string) => /favorite|收藏/i.test(e))) {
        out.push({
          type: 'favorite',
          date: r.recordedAt.toISOString(),
          summary:
            locale === 'en'
              ? `Favorited · ${r.content.slice(0, 24)}`
              : `收藏 · ${r.content.slice(0, 24)}`,
          related_therapist_id: r.refTherapistId ?? undefined,
        });
        if (out.filter((o) => o.type === 'favorite').length >= 2) break;
      }
    }
  } catch {
    // 忽略
  }

  // view 行为暂不实现(无 events 表的索引) · PRD 已注明可空
  // 按 date 倒序 + 截 5 条
  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return out.slice(0, 5);
}

// ──────────────── smart_chips ────────────────

function defaultChips(locale: AssistantLocale): HomeSmartChip[] {
  if (locale === 'en') {
    return [
      { key: 'tonight', label: 'Free tonight', intent_seed: 'Who can take me tonight?' },
      { key: 'nearby', label: 'Nearby', intent_seed: 'Who is nearby?' },
      { key: 'budget', label: 'In budget', intent_seed: 'Pick within my budget' },
    ];
  }
  return [
    { key: 'tonight', label: '今晚有空', intent_seed: '今晚谁能接?' },
    { key: 'nearby', label: '附近', intent_seed: '附近有谁?' },
    { key: 'budget', label: '预算内', intent_seed: '按我的预算挑' },
  ];
}

async function buildSmartChips(
  ctx: HomeContext,
  userId: string,
  locale: AssistantLocale,
  isNewUser: boolean,
): Promise<HomeSmartChip[]> {
  const chips = defaultChips(locale);
  if (isNewUser) return chips;

  // 老客增 "像 Mira 那种" chip · 取 L4 favorite top 1 技师名
  try {
    const rels = await readReference(ctx, userId, 'relation', 5);
    for (const r of rels) {
      if (!r.refTherapistId) continue;
      const t = await ctx.db.query.therapists.findFirst({
        where: eq(therapists.id, r.refTherapistId),
      });
      if (!t) continue;
      const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
      const name = (u?.displayName ?? (t.bio ?? '').slice(0, 8)).trim();
      if (name) {
        chips.push({
          key: `like_${t.id.slice(0, 8)}`,
          label: locale === 'en' ? `Like ${name}` : `像 ${name} 那种`,
          intent_seed:
            locale === 'en'
              ? `Find someone similar to ${name}`
              : `找像 ${name} 那种风格的`,
        });
        break;
      }
    }
  } catch {
    // 忽略
  }

  // 老客也加 "换 3 个" / "告诉我想要啥" 两个固定
  if (locale === 'en') {
    chips.push({
      key: 'refresh',
      label: 'Refresh 3',
      intent_seed: 'show me 3 different ones',
    });
    chips.push({
      key: 'describe',
      label: 'I know what I want',
      intent_seed: 'Let me tell you what I want',
    });
  } else {
    chips.push({
      key: 'refresh',
      label: '换 3 个',
      intent_seed: '再帮我换 3 个',
    });
    chips.push({
      key: 'describe',
      label: '告诉我想要啥',
      intent_seed: '我跟你说我想要啥',
    });
  }

  return chips;
}

// ──────────────── 判定是否新用户 ────────────────

async function isNewUser(ctx: HomeContext, userId: string): Promise<boolean> {
  const complete = await isOnboardingComplete(ctx, userId);
  return !complete;
}

// ──────────────── 主入口 ────────────────

export async function getAssistantHome(
  ctx: HomeContext,
  userId: string,
  localeOverride?: AssistantLocale,
  gateway?: LLMGateway,
): Promise<AssistantHome> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const locale = localeOverride ?? normalizeLocale(u?.locale);
  const newUser = await isNewUser(ctx, userId);

  // 拉客户 city(优先 L1 facts.city)
  const saved = await readSaved(ctx, userId);
  const factsAny = (saved?.facts ?? {}) as { city?: string };
  const city = factsAny.city;

  // 并发组装(memory_cta / picks / activity / chips)
  const [greeting, memoryCta, todayPicks, recentActivity, smartChips] = await Promise.all([
    buildGreetingForUser(ctx, userId, locale, u ?? null),
    buildMemoryCta(ctx, userId, locale, newUser),
    buildTodayPicks(ctx, gateway ?? null, userId, locale, {
      isNewUser: newUser,
      city,
    }),
    buildRecentActivity(ctx, userId, locale, newUser),
    buildSmartChips(ctx, userId, locale, newUser),
  ]);

  return {
    greeting,
    memory_cta: memoryCta,
    today_picks: todayPicks,
    recent_activity: recentActivity,
    smart_chips: smartChips,
    onboarding_required: newUser,
  };
}

// ──────────────── refresh-picks ────────────────

export async function refreshTodayPicks(
  ctx: HomeContext,
  userId: string,
  args: { refreshToken?: string; gateway?: LLMGateway; localeOverride?: AssistantLocale },
): Promise<HomeTodayPicks> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const locale = args.localeOverride ?? normalizeLocale(u?.locale);
  const newUser = await isNewUser(ctx, userId);
  const saved = await readSaved(ctx, userId);
  const factsAny = (saved?.facts ?? {}) as { city?: string };
  const city = factsAny.city;

  // 排除上次返回的 ids · 进程内缓存
  const exclude = readExclude(userId);
  // seedOffset 用 refreshToken 哈希 · 没有就用时间戳
  const seedOffset = (args.refreshToken?.length ?? Date.now() % 1000) + 1;

  const picks = await buildTodayPicks(ctx, args.gateway ?? null, userId, locale, {
    isNewUser: newUser,
    city,
    excludeIds: exclude,
    seedOffset,
  });
  return picks;
}

/**
 * 完成 onboarding 后预生成 today_picks 写进程缓存
 * 让首次 home 渲染立刻有内容(F03-Home4)
 */
export async function primeTodayPicksAfterOnboarding(
  ctx: HomeContext,
  userId: string,
  args?: { gateway?: LLMGateway; localeOverride?: AssistantLocale },
): Promise<HomeTodayPicks> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const locale = args?.localeOverride ?? normalizeLocale(u?.locale);
  const saved = await readSaved(ctx, userId);
  const factsAny = (saved?.facts ?? {}) as { city?: string };
  const city = factsAny.city;
  // 标记 onboarding 已完成 → 走老客路径
  return buildTodayPicks(ctx, args?.gateway ?? null, userId, locale, {
    isNewUser: false,
    city,
  });
}

// ──────────────── 会话写入(chat 路由侧调) ────────────────

/** 写一条新会话 / 更新已有会话(用于 home recent_activity) */
export async function upsertAssistantSession(
  ctx: HomeContext,
  args: {
    userId: string;
    sessionId?: string;
    firstUserMessage?: string;
    turnsIncrement?: number;
  },
): Promise<{ id: string }> {
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

// 让 unused 引用不报 lint
void customerOutreachState;
void gte;
