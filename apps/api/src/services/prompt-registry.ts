/**
 * Prompt Registry service · 提示词版本库读写(分层治理)
 *
 * - getActivePrompt(key): 装配层用 · 读当前 active 版本 content · 查不到返 null(调用方 fallback 硬编码常量)
 *   高频(每次对话调)→ 内存缓存 60s
 * - saveDraft / publishVersion / rollback: 后台 CRUD 用 · 改=插新版本,发布=切 active(旧→archived)
 *
 * 设计依据:[[reference_loverush_prompt_governance]] 分层治理。A 风控层 key 标 layer='A'(后台只读)。
 */
import type { Database } from '@loverush/db';
import { promptTemplates } from '@loverush/db';
import { and, eq, desc } from 'drizzle-orm';

export interface RegistryContext {
  db: Database;
}

// 内存缓存 active content · 60s · 避免每次对话查库(参考 fx.ts 同款)
const activeCache = new Map<string, { content: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/** 读某 key 当前 active 版本 content · 查不到返 null(调用方 fallback 硬编码常量) */
export async function getActivePrompt(ctx: RegistryContext, key: string): Promise<string | null> {
  const now = Date.now();
  const hit = activeCache.get(key);
  if (hit && hit.expiresAt > now) return hit.content;
  try {
    const row = await ctx.db.query.promptTemplates.findFirst({
      where: and(eq(promptTemplates.key, key), eq(promptTemplates.status, 'active')),
    });
    const content = row?.content ?? null;
    activeCache.set(key, { content, expiresAt: now + CACHE_TTL_MS });
    return content;
  } catch {
    // 表未建/查询失败 → 返 null · 装配层 fallback 硬编码常量,不阻断对话(部署窗口/迁移未跑也安全)
    return null;
  }
}

// 灰度缓存:active content + rolloutPct + 上一归档版本(对照组),按 key 缓存,分桶在内存算
const rolloutCache = new Map<
  string,
  { activeContent: string | null; rolloutPct: number; prevContent: string | null; expiresAt: number }
>();

/** 确定性字符串 hash(userId → 稳定桶位),不依赖 crypto · 同 userId 永远同桶(灰度命中稳定) */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 按 rolloutPct 灰度挑版本(纯函数,可测)：
 * - active 为空 → null(调用方 fallback 硬编码)
 * - rolloutPct>=100 或无对照组 → active(全量)
 * - rolloutPct<=0 → prev(active 暂不放量)
 * - 否则按 userId 稳定分桶:命中灰度→active,未命中→上一归档版本(对照组)
 */
export function pickByRollout(args: {
  activeContent: string | null;
  rolloutPct: number;
  prevContent: string | null;
  userId: string;
}): string | null {
  const { activeContent, rolloutPct, prevContent, userId } = args;
  if (activeContent == null) return null;
  if (rolloutPct >= 100 || prevContent == null) return activeContent;
  if (rolloutPct <= 0) return prevContent;
  return hashStr(userId) % 100 < rolloutPct ? activeContent : prevContent;
}

/**
 * 灰度版 getActivePrompt：按 active 版本的 rolloutPct + userId 稳定分桶决定发新版还是上一版。
 * rolloutPct=100(默认)→ 行为完全等同 getActivePrompt(零回归)。新风控话术可 1%→5%→100% 灰度。
 */
export async function getActivePromptFor(
  ctx: RegistryContext,
  key: string,
  userId: string,
): Promise<string | null> {
  const now = Date.now();
  let entry = rolloutCache.get(key);
  if (!entry || entry.expiresAt <= now) {
    try {
      const rows = await ctx.db.query.promptTemplates.findMany({
        where: eq(promptTemplates.key, key),
        orderBy: [desc(promptTemplates.version)],
      });
      const active = rows.find((r) => r.status === 'active') ?? null;
      const prevArchived = rows.find((r) => r.status === 'archived') ?? null; // version 最大的归档=上一 active
      entry = {
        activeContent: active?.content ?? null,
        rolloutPct: active?.rolloutPct ?? 100,
        prevContent: prevArchived?.content ?? null,
        expiresAt: now + CACHE_TTL_MS,
      };
      rolloutCache.set(key, entry);
    } catch {
      return null; // 表未建/查询失败 → fallback 硬编码,不阻断
    }
  }
  return pickByRollout({
    activeContent: entry.activeContent,
    rolloutPct: entry.rolloutPct,
    prevContent: entry.prevContent,
    userId,
  });
}

/** 清缓存 · 发布/回滚后调 */
export function clearPromptCache(): void {
  activeCache.clear();
  rolloutCache.clear();
}

/** 某 key 全版本(后台版本历史 · 新→旧) */
export async function listVersions(ctx: RegistryContext, key: string) {
  return ctx.db.query.promptTemplates.findMany({
    where: eq(promptTemplates.key, key),
    orderBy: [desc(promptTemplates.version)],
  });
}

/** 所有 key 的当前 active(后台列表) */
export async function listActiveTemplates(ctx: RegistryContext) {
  return ctx.db.query.promptTemplates.findMany({
    where: eq(promptTemplates.status, 'active'),
    orderBy: [desc(promptTemplates.createdAt)],
  });
}

/** 存新草稿版本(version = 该 key max+1) · 不影响当前 active */
export async function saveDraft(
  ctx: RegistryContext,
  args: {
    key: string;
    content: string;
    layer?: string;
    label?: string | null;
    changeNote?: string | null;
    createdBy?: string | null;
  },
) {
  const last = await ctx.db.query.promptTemplates.findFirst({
    where: eq(promptTemplates.key, args.key),
    orderBy: [desc(promptTemplates.version)],
  });
  const version = (last?.version ?? 0) + 1;
  const rows = await ctx.db
    .insert(promptTemplates)
    .values({
      key: args.key,
      version,
      content: args.content,
      layer: args.layer ?? last?.layer ?? 'B',
      label: args.label ?? last?.label ?? null,
      changeNote: args.changeNote ?? null,
      status: 'draft',
      createdBy: args.createdBy ?? null,
    })
    .returning();
  return rows[0]!;
}

/**
 * 发布某版本为 active(旧 active → archived) · 事务保证同 key 仅一条 active
 * 回滚=把历史 version 重新 publish(同一逻辑)
 */
export async function publishVersion(
  ctx: RegistryContext,
  args: { key: string; version: number },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(promptTemplates)
      .set({ status: 'archived' })
      .where(and(eq(promptTemplates.key, args.key), eq(promptTemplates.status, 'active')));
    await tx
      .update(promptTemplates)
      .set({ status: 'active' })
      .where(and(eq(promptTemplates.key, args.key), eq(promptTemplates.version, args.version)));
  });
  clearPromptCache();
}
