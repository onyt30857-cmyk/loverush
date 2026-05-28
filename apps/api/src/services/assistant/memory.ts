/**
 * 5 层记忆读写 + bi-temporal · PRD §4.1
 *
 * - L1 facts          → customer_saved_memory.facts
 * - L2 stable_prefs   → customer_saved_memory.stable_prefs / shame_safe_prefs / taboo_zones
 * - L3 rotating       → customer_reference_memory (memory_type='rotating')
 * - L4 relations      → customer_reference_memory (memory_type='relation')
 * - L5 diff           → customer_reference_memory (memory_type='diff')
 *
 * bi-temporal:写入新事实自动把旧事实 valid_to=NOW();不物理删除。
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  Database,
  customerSavedMemory,
  customerReferenceMemory,
  type CustomerSavedMemory,
  type CustomerReferenceMemory,
  type NewCustomerReferenceMemory,
} from '@loverush/db';

export interface MemoryContext {
  db: Database;
}

// ──────────────── L1 + L2 读写 ────────────────

export async function readSaved(
  ctx: MemoryContext,
  userId: string,
): Promise<CustomerSavedMemory | null> {
  const row = await ctx.db.query.customerSavedMemory.findFirst({
    where: eq(customerSavedMemory.userId, userId),
  });
  return row ?? null;
}

/**
 * upsert Saved Memory · L1 + L2 都走这里
 *
 * patch:浅合并 facts / stable_prefs / shame_safe_prefs / taboo_zones
 */
export async function upsertSaved(
  ctx: MemoryContext,
  userId: string,
  patch: {
    facts?: Record<string, unknown>;
    stablePrefs?: Record<string, unknown>;
    shameSafePrefs?: Record<string, unknown>;
    tabooZones?: string[];
  },
): Promise<CustomerSavedMemory> {
  const existing = await readSaved(ctx, userId);
  if (!existing) {
    const [row] = await ctx.db
      .insert(customerSavedMemory)
      .values({
        userId,
        facts: patch.facts ?? {},
        stablePrefs: patch.stablePrefs ?? {},
        shameSafePrefs: patch.shameSafePrefs ?? {},
        tabooZones: patch.tabooZones ?? [],
      })
      .returning();
    if (!row) throw new Error('saved_memory insert failed');
    return row;
  }
  const merged = {
    facts: { ...(existing.facts ?? {}), ...(patch.facts ?? {}) },
    stablePrefs: { ...(existing.stablePrefs ?? {}), ...(patch.stablePrefs ?? {}) },
    shameSafePrefs: { ...(existing.shameSafePrefs ?? {}), ...(patch.shameSafePrefs ?? {}) },
    tabooZones: patch.tabooZones
      ? Array.from(new Set([...(existing.tabooZones ?? []), ...patch.tabooZones]))
      : existing.tabooZones,
    updatedAt: new Date(),
  };
  const [row] = await ctx.db
    .update(customerSavedMemory)
    .set(merged)
    .where(eq(customerSavedMemory.userId, userId))
    .returning();
  if (!row) throw new Error('saved_memory update failed');
  return row;
}

// ──────────────── L3 / L4 / L5 读 ────────────────

/**
 * 读 Reference Memory · 按 type + 当前有效
 */
export async function readReference(
  ctx: MemoryContext,
  userId: string,
  type: 'rotating' | 'relation' | 'diff',
  limit = 10,
): Promise<CustomerReferenceMemory[]> {
  return ctx.db.query.customerReferenceMemory.findMany({
    where: and(
      eq(customerReferenceMemory.userId, userId),
      eq(customerReferenceMemory.memoryType, type),
      isNull(customerReferenceMemory.validTo),
      isNull(customerReferenceMemory.archivedAt),
    ),
    orderBy: [
      desc(customerReferenceMemory.importance),
      desc(customerReferenceMemory.recordedAt),
    ],
    limit,
  });
}

/**
 * 读全部三种类型(用于 export / admin / 注入 prompt)
 */
export async function readAllReference(
  ctx: MemoryContext,
  userId: string,
  perTypeLimit = 10,
): Promise<{
  rotating: CustomerReferenceMemory[];
  relation: CustomerReferenceMemory[];
  diff: CustomerReferenceMemory[];
}> {
  const [rotating, relation, diff] = await Promise.all([
    readReference(ctx, userId, 'rotating', perTypeLimit),
    readReference(ctx, userId, 'relation', perTypeLimit),
    readReference(ctx, userId, 'diff', perTypeLimit),
  ]);
  return { rotating, relation, diff };
}

// ──────────────── L3 写(rotating) ────────────────

export async function writeRotating(
  ctx: MemoryContext,
  userId: string,
  args: {
    content: string;
    entities?: string[];
    importance?: number;
    clusterId?: number;
    endpoint?: 'cloud' | 'edge';
  },
): Promise<CustomerReferenceMemory> {
  const [row] = await ctx.db
    .insert(customerReferenceMemory)
    .values({
      userId,
      memoryType: 'rotating',
      content: args.content,
      entities: args.entities ?? [],
      importance: args.importance ?? 5,
      clusterId: args.clusterId,
      endpoint: args.endpoint ?? 'cloud',
    })
    .returning();
  if (!row) throw new Error('rotating memory insert failed');
  return row;
}

// ──────────────── L4 写(relation) ────────────────

export async function writeRelation(
  ctx: MemoryContext,
  userId: string,
  args: {
    therapistId: string;
    orderId?: string;
    content: string;
    entities?: string[];
    importance?: number;
  },
): Promise<CustomerReferenceMemory> {
  const [row] = await ctx.db
    .insert(customerReferenceMemory)
    .values({
      userId,
      memoryType: 'relation',
      content: args.content,
      entities: args.entities ?? [],
      importance: args.importance ?? 6,
      refTherapistId: args.therapistId,
      refOrderId: args.orderId,
    })
    .returning();
  if (!row) throw new Error('relation memory insert failed');
  return row;
}

// ──────────────── L5 写(diff) ────────────────

export async function writeDiff(
  ctx: MemoryContext,
  userId: string,
  args: {
    content: string;
    entities?: string[];
    importance?: number;
    refTherapistId?: string;
  },
): Promise<CustomerReferenceMemory> {
  const [row] = await ctx.db
    .insert(customerReferenceMemory)
    .values({
      userId,
      memoryType: 'diff',
      content: args.content,
      entities: args.entities ?? [],
      importance: args.importance ?? 7,
      refTherapistId: args.refTherapistId,
    })
    .returning();
  if (!row) throw new Error('diff memory insert failed');
  return row;
}

// ──────────────── 失效旧事实(bi-temporal) ────────────────

/**
 * 把所有命中 predicate 的旧条目 valid_to=NOW(),不物理删除。
 * 用于"上次说喜欢 X,这次说不喜欢 X"场景。
 */
export async function invalidate(
  ctx: MemoryContext,
  args: {
    userId: string;
    type: 'rotating' | 'relation' | 'diff';
    matchEntity?: string;
    matchRefTherapistId?: string;
  },
): Promise<number> {
  const conds = [
    eq(customerReferenceMemory.userId, args.userId),
    eq(customerReferenceMemory.memoryType, args.type),
    isNull(customerReferenceMemory.validTo),
  ];
  if (args.matchRefTherapistId) {
    conds.push(eq(customerReferenceMemory.refTherapistId, args.matchRefTherapistId));
  }
  const rows = await ctx.db
    .update(customerReferenceMemory)
    .set({ validTo: new Date() })
    .where(and(...conds))
    .returning({ id: customerReferenceMemory.id });
  // matchEntity 在 SQL 层用 array contains,要单独处理
  if (args.matchEntity) {
    const more = await ctx.db
      .update(customerReferenceMemory)
      .set({ validTo: new Date() })
      .where(
        and(
          eq(customerReferenceMemory.userId, args.userId),
          eq(customerReferenceMemory.memoryType, args.type),
          isNull(customerReferenceMemory.validTo),
          sql`${customerReferenceMemory.entities} @> ARRAY[${args.matchEntity}]::text[]`,
        ),
      )
      .returning({ id: customerReferenceMemory.id });
    return rows.length + more.length;
  }
  return rows.length;
}

// ──────────────── 把 L1 + L2 压成自然语言 snippet(给 prompt 用) ────────────────

export function compactSavedToSnippet(saved: CustomerSavedMemory | null): string {
  if (!saved) return '';
  const lines: string[] = [];
  const f = saved.facts ?? {};
  if (f.city) lines.push(`城市:${f.city}`);
  if (f.gender) lines.push(`性别:${f.gender}`);
  if (f.language) lines.push(`语言:${f.language}`);
  if (f.ageRange) lines.push(`年龄段:${f.ageRange}`);
  if (f.origin) lines.push(`籍贯:${f.origin}`);
  const s = saved.stablePrefs ?? {};
  if (Array.isArray(s.dislikes) && s.dislikes.length)
    lines.push(`稳定不喜欢:${(s.dislikes as string[]).join(' / ')}`);
  if (Array.isArray(s.priorities) && s.priorities.length)
    lines.push(`稳定偏好:${(s.priorities as string[]).join(' / ')}`);
  if (s.priceBand) lines.push(`价位段:${s.priceBand}`);
  if (saved.tabooZones?.length) lines.push(`禁忌:${saved.tabooZones.join(' / ')}`);
  return lines.join('\n');
}

// ──────────────── 软删 / 归档 / 30 天物理删除 ────────────────

/**
 * 把 L3 中年龄 > daysOld 的归档(写 archivedAt)
 * 真正派生到 L5 由 jobs/assistant-archive-rotating.ts 调用 diff.ts 完成
 */
export async function archiveOldRotating(
  ctx: MemoryContext,
  daysOld = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 3600 * 1000);
  const rows = await ctx.db
    .update(customerReferenceMemory)
    .set({ archivedAt: new Date(), validTo: new Date() })
    .where(
      and(
        eq(customerReferenceMemory.memoryType, 'rotating'),
        isNull(customerReferenceMemory.archivedAt),
        sql`${customerReferenceMemory.validFrom} < ${cutoff}`,
      ),
    )
    .returning({ id: customerReferenceMemory.id, userId: customerReferenceMemory.userId });
  return rows.length;
}

/**
 * 标记一键擦除 · 30 天 grace
 */
export async function scheduleDeletion(
  ctx: MemoryContext,
  userId: string,
): Promise<void> {
  await ctx.db
    .update(customerSavedMemory)
    .set({ deletionScheduledAt: new Date(), updatedAt: new Date() })
    .where(eq(customerSavedMemory.userId, userId));
}

/**
 * 真删除(30 天后 cron 调) · CASCADE 由外键级联清 reference / clusters / outreach
 */
export async function purgeIfScheduled(
  ctx: MemoryContext,
  daysOld = 30,
): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 3600 * 1000);
  const rows = await ctx.db
    .delete(customerSavedMemory)
    .where(
      and(
        sql`${customerSavedMemory.deletionScheduledAt} IS NOT NULL`,
        sql`${customerSavedMemory.deletionScheduledAt} < ${cutoff}`,
      ),
    )
    .returning({ userId: customerSavedMemory.userId });
  return rows.length;
}
