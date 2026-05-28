/**
 * 预判式 push + 沉默召回 · PRD §3.4 + §6.4 + §6.5
 *
 * 主动 push 三命中规则:
 *   1. 时段规律(过去 4 次预约在相同时段 ±30min)
 *   2. 偏好稳定(L2 + L4 一致 + 有偏好技师)
 *   3. 候选可用(下一个该时段有候选空档)
 *
 * 频率上限:
 *   - 主动 push ≤ 2/周
 *   - 沉默召回 ≤ 1/月 · 30+ 天无单触发
 *   - 客户一键关闭主权(proactiveEnabled / silentRecallEnabled)
 */

import { eq, and, sql } from 'drizzle-orm';
import type { LLMGateway } from '@loverush/llm';
import {
  Database,
  customerOutreachState,
  orders,
  type CustomerOutreachState,
} from '@loverush/db';
import { readSaved, readReference, type MemoryContext } from './memory';

export interface OutreachContext extends MemoryContext {
  db: Database;
}

export interface RegularTimeSlot {
  weekday: number; // 0-6
  hourStart: number; // 0-23
  hourEnd: number;
}

// ──────────────── upsert / read state ────────────────

export async function ensureState(
  ctx: OutreachContext,
  userId: string,
): Promise<CustomerOutreachState> {
  const existing = await ctx.db.query.customerOutreachState.findFirst({
    where: eq(customerOutreachState.userId, userId),
  });
  if (existing) return existing;
  const [row] = await ctx.db
    .insert(customerOutreachState)
    .values({ userId })
    .returning();
  if (!row) throw new Error('outreach state insert failed');
  return row;
}

export async function setOptOut(
  ctx: OutreachContext,
  userId: string,
  opts: { disableProactive?: boolean; disableRecall?: boolean },
): Promise<void> {
  await ensureState(ctx, userId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (opts.disableProactive !== undefined) patch.proactiveEnabled = !opts.disableProactive;
  if (opts.disableRecall !== undefined) patch.silentRecallEnabled = !opts.disableRecall;
  await ctx.db
    .update(customerOutreachState)
    .set(patch)
    .where(eq(customerOutreachState.userId, userId));
}

// ──────────────── 频控 ────────────────

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getUTCDay(); // 0 = Sun
  const diff = (day + 6) % 7; // 周一为周首
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** push 频控:每周 ≤ 2 · 自动按周重置 */
export async function canSendPush(
  ctx: OutreachContext,
  userId: string,
): Promise<{ ok: boolean; reason?: string; state: CustomerOutreachState }> {
  const state = await ensureState(ctx, userId);
  if (!state.proactiveEnabled) return { ok: false, reason: 'opted_out', state };
  const now = new Date();
  const weekStart = startOfWeek(now);
  // 周边界重置
  if (!state.weeklyPushResetAt || new Date(state.weeklyPushResetAt) < weekStart) {
    const [updated] = await ctx.db
      .update(customerOutreachState)
      .set({ weeklyPushCount: 0, weeklyPushResetAt: weekStart, updatedAt: now })
      .where(eq(customerOutreachState.userId, userId))
      .returning();
    if (updated && updated.weeklyPushCount < 2) {
      return { ok: true, state: updated };
    }
  }
  if (state.weeklyPushCount >= 2) {
    return { ok: false, reason: 'weekly_cap_reached', state };
  }
  return { ok: true, state };
}

/** recall 频控:每月 ≤ 1 */
export async function canSendRecall(
  ctx: OutreachContext,
  userId: string,
): Promise<{ ok: boolean; reason?: string; state: CustomerOutreachState }> {
  const state = await ensureState(ctx, userId);
  if (!state.silentRecallEnabled) return { ok: false, reason: 'opted_out', state };
  const now = new Date();
  const monthStart = startOfMonth(now);
  if (!state.monthlyRecallResetAt || new Date(state.monthlyRecallResetAt) < monthStart) {
    const [updated] = await ctx.db
      .update(customerOutreachState)
      .set({ monthlyRecallCount: 0, monthlyRecallResetAt: monthStart, updatedAt: now })
      .where(eq(customerOutreachState.userId, userId))
      .returning();
    if (updated && updated.monthlyRecallCount < 1) {
      return { ok: true, state: updated };
    }
  }
  if (state.monthlyRecallCount >= 1) {
    return { ok: false, reason: 'monthly_cap_reached', state };
  }
  return { ok: true, state };
}

// ──────────────── 计数 ────────────────

export async function recordPushSent(ctx: OutreachContext, userId: string): Promise<void> {
  const now = new Date();
  await ctx.db
    .update(customerOutreachState)
    .set({
      weeklyPushCount: sql`${customerOutreachState.weeklyPushCount} + 1`,
      lastPushAt: now,
      updatedAt: now,
    })
    .where(eq(customerOutreachState.userId, userId));
}

export async function recordRecallSent(ctx: OutreachContext, userId: string): Promise<void> {
  const now = new Date();
  await ctx.db
    .update(customerOutreachState)
    .set({
      monthlyRecallCount: sql`${customerOutreachState.monthlyRecallCount} + 1`,
      lastRecallAt: now,
      updatedAt: now,
    })
    .where(eq(customerOutreachState.userId, userId));
}

// ──────────────── 时段规律推断 ────────────────

/**
 * 从客户最近 N 单订单时间推断固定时段
 * 规则:过去 ≥ 4 单都在同一 weekday 的 ±30min 窗口 → 视为固定时段
 */
export async function inferRegularSlot(
  ctx: OutreachContext,
  userId: string,
): Promise<RegularTimeSlot | null> {
  const recent = await ctx.db.query.orders.findMany({
    where: eq(orders.customerId, userId),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });
  if (recent.length < 4) return null;
  // 取每单的 (weekday, hour) · 优先用 scheduledAt(预约时段)
  const slots = recent
    .map((o) => o.scheduledAt ?? o.createdAt)
    .filter((d): d is Date => !!d)
    .map((d) => ({ wd: d.getUTCDay(), hour: d.getUTCHours() }));

  // 找出现 ≥ 3 次的 (wd, hour ±1) 组合
  const counter = new Map<string, number>();
  for (const s of slots) {
    for (let h = s.hour - 1; h <= s.hour + 1; h++) {
      const key = `${s.wd}:${((h + 24) % 24)}`;
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
  }
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [k, c] of counter.entries()) {
    if (c > bestCount) {
      bestCount = c;
      bestKey = k;
    }
  }
  if (!bestKey || bestCount < 3) return null;
  const [wdStr, hourStr] = bestKey.split(':');
  const weekday = parseInt(wdStr!, 10);
  const hour = parseInt(hourStr!, 10);
  return { weekday, hourStart: hour, hourEnd: (hour + 1) % 24 };
}

// ──────────────── 三命中检测 ────────────────

export interface PushHitResult {
  hit: boolean;
  /** 缺失的命中点(用于审计) */
  missing: ('regular_slot' | 'stable_pref' | 'available_now')[];
  regularSlot?: RegularTimeSlot;
}

/**
 * 三命中规则检测 · 不实际发 push,只判断"现在能不能 push"
 *
 * candidateAvailable 由调用方注入(需要查 therapist 可用性 · 解耦)
 */
export async function checkPushTriggers(
  ctx: OutreachContext,
  userId: string,
  candidateAvailable: boolean,
): Promise<PushHitResult> {
  const missing: PushHitResult['missing'] = [];

  // 1. 时段规律
  const slot = await inferRegularSlot(ctx, userId);
  if (!slot) missing.push('regular_slot');

  // 2. 偏好稳定:L2 stable_prefs.priorities 非空 + L4 有 ≥ 2 条
  const saved = await readSaved(ctx, userId);
  const priorities =
    saved?.stablePrefs && Array.isArray((saved.stablePrefs as Record<string, unknown>).priorities)
      ? (saved.stablePrefs as { priorities: string[] }).priorities
      : [];
  const relations = await readReference(ctx, userId, 'relation', 5);
  if (priorities.length === 0 || relations.length < 2) missing.push('stable_pref');

  // 3. 候选可用
  if (!candidateAvailable) missing.push('available_now');

  return {
    hit: missing.length === 0,
    missing,
    regularSlot: slot ?? undefined,
  };
}

// ──────────────── 沉默判定 ────────────────

const SILENCE_DAYS = 30;

/**
 * 判定客户是否进入沉默期(30+ 天无单)
 */
export async function isSilent(ctx: OutreachContext, userId: string): Promise<boolean> {
  const state = await ensureState(ctx, userId);
  const last = state.lastOrderAt ? new Date(state.lastOrderAt) : null;
  if (!last) {
    // 没下过单也算 — 但首单转化由 S1 流程负责,这里只看老客
    return false;
  }
  const days = (Date.now() - last.getTime()) / (24 * 3600 * 1000);
  return days >= SILENCE_DAYS;
}

// ──────────────── 召回话术生成 ────────────────

const RECALL_SYS = `你是 LoveRush 小助理 · 给沉默客户生成召回话术 · PRD §6.4。
风格:好哥们 · 称"你"非"您" · 1-2 句 · 不群发感 · 不堆 emoji · 不"我们想你"。
基于客户最近的 L4 关系层 + L5 diff,挑一个具体的钩子。

输出纯文本 · 不要 JSON · 不要解释`;

export async function generateRecallMessage(
  ctx: OutreachContext,
  gateway: LLMGateway,
  userId: string,
): Promise<string | null> {
  const relations = await readReference(ctx, userId, 'relation', 3);
  const diffs = await readReference(ctx, userId, 'diff', 3);
  if (relations.length === 0 && diffs.length === 0) {
    return '好久不见 · 我帮你看了下 · 你之前喜欢的那位最近时段松了 · 想看看吗?';
  }
  const bullets = [
    ...relations.map((r) => `- 关系:${r.content}`),
    ...diffs.map((d) => `- 趋势:${d.content}`),
  ].join('\n');

  try {
    const res = await gateway.complete({
      tier: 'T1',
      system: RECALL_SYS,
      messages: [
        {
          role: 'user',
          content: `客户最近的记忆片段:\n${bullets}\n\n生成召回话术:`,
        },
      ],
      maxTokens: 120,
      temperature: 0.7,
      userId,
      tag: 'assistant.recall',
    });
    return res.content.trim() || null;
  } catch {
    return null;
  }
}

// ──────────────── push 话术生成 ────────────────

const PUSH_SYS = `你是 LoveRush 小助理 · 给规律时段空闲生成 push · PRD §6.5。
风格:好哥们 · 1-2 句 · 直接说"你的固定时段 · 谁谁空 · 要约吗?"
不要 emoji 串 · 不要"亲爱的"。

输出纯文本 · 不要 JSON`;

export async function generatePushMessage(
  gateway: LLMGateway,
  args: {
    userId: string;
    slot: RegularTimeSlot;
    candidateNames: string[];
  },
): Promise<string | null> {
  const dayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayLabel = dayMap[args.slot.weekday] ?? '';
  const hourLabel = `${args.slot.hourStart}-${args.slot.hourEnd}点`;
  const candidates = args.candidateNames.slice(0, 2).join(' / ');
  // 没 LLM 也能兜底
  const fallback = `你的固定时段 ${dayLabel} ${hourLabel} · ${candidates} 这周空 · 要约吗?`;
  try {
    const res = await gateway.complete({
      tier: 'T2',
      system: PUSH_SYS,
      messages: [
        {
          role: 'user',
          content: `客户固定时段:${dayLabel} ${hourLabel}\n这周空档:${candidates}\n生成 push:`,
        },
      ],
      maxTokens: 80,
      temperature: 0.5,
      userId: args.userId,
      tag: 'assistant.push',
    });
    return res.content.trim() || fallback;
  } catch {
    return fallback;
  }
}

/** 更新 lastOrderAt(由订单创建 hook 调) */
export async function noteOrderCreated(
  ctx: OutreachContext,
  userId: string,
  at = new Date(),
): Promise<void> {
  await ensureState(ctx, userId);
  await ctx.db
    .update(customerOutreachState)
    .set({ lastOrderAt: at, updatedAt: new Date() })
    .where(eq(customerOutreachState.userId, userId));
}
