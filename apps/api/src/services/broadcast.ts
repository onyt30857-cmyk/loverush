/**
 * 通知群发 service · M13 Phase 0
 *
 * 三个核心函数:
 *   1. resolveAudience(db, rule)        AudienceRule → user_id[]
 *   2. enqueueBatch(ctx, args)          一批 user 同步 insert notifications + deliveries
 *   3. runBroadcast(ctx, broadcastId)   接管整个发送流程(更新状态机)
 *
 * 设计:
 *   - 偏好检查在 batch 内逐 user 决策(不绕过用户 unless bypassUserPrefs=1)
 *   - 投递分 chunk 500/批 · 避免 PG 参数数量爆
 *   - web push fan-out 走原 notifications.enqueue 通道(本期不另写)· 但 batch 同步只写 in_app
 *     原因:同步触发 N 次 web push 在一个 API 调用里会慢/超时 · 留 Phase 1 用 job 拉
 *     本期 Phase 0 仅保证 in_app 立即可见 · web_push fanout 见 PR 注释
 */

import { and, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  users,
  notifications,
  userPushPreferences,
  customerBehaviorProfile,
  therapists,
  notificationBroadcasts,
  notificationBroadcastDeliveries,
  type AudienceRule,
  type UserPushPreference,
  type NewNotification,
  type NewNotificationBroadcastDelivery,
} from '@loverush/db';
import type { NotifyContext } from './notifications';
import { logger } from './logger';

const CHUNK_SIZE = 500;

// ──────────────────── resolveAudience ────────────────────

/**
 * 把 AudienceRule 转 user_id[] · 含 active + 未封 过滤
 *
 * 共同前置:user.status='active' AND banned_at IS NULL
 */
export async function resolveAudience(ctx: NotifyContext, rule: AudienceRule): Promise<string[]> {
  const baseConds = [eq(users.status, 'active'), isNull(users.bannedAt)];

  switch (rule.kind) {
    case 'all_active': {
      const conds = [...baseConds];
      if (rule.userType) conds.push(eq(users.userType, rule.userType));
      const rows = await ctx.db.select({ id: users.id }).from(users).where(and(...conds));
      return rows.map((r) => r.id);
    }

    case 'by_locale': {
      if (rule.locales.length === 0) return [];
      // users.locale 是 PG enum · drizzle inArray 不接 string[] · 用 SQL ANY
      const conds = [...baseConds, sql`${users.locale}::text = ANY(${rule.locales}::text[])`];
      if (rule.userType) conds.push(eq(users.userType, rule.userType));
      const rows = await ctx.db.select({ id: users.id }).from(users).where(and(...conds));
      return rows.map((r) => r.id);
    }

    case 'by_city': {
      if (rule.cities.length === 0) return [];
      // 城市过滤目前只对技师生效(therapists.serviceCity);客户没城市字段 · 留 Phase 1 加
      const conds = [...baseConds, eq(users.userType, 'therapist'), inArray(therapists.serviceCity, rule.cities)];
      const rows = await ctx.db
        .select({ id: users.id })
        .from(users)
        .innerJoin(therapists, eq(therapists.userId, users.id))
        .where(and(...conds));
      return rows.map((r) => r.id);
    }

    case 'dormant': {
      if (rule.daysSince < 1) return [];
      const cutoff = new Date(Date.now() - rule.daysSince * 86_400_000);
      const conds = [
        ...baseConds,
        eq(users.userType, rule.userType),
        lt(users.lastActiveAt, cutoff),
      ];
      const rows = await ctx.db.select({ id: users.id }).from(users).where(and(...conds));
      return rows.map((r) => r.id);
    }

    case 'high_value': {
      if (rule.minOrders < 1) return [];
      // 客户 + 累计订单 ≥ N
      const conds = [
        ...baseConds,
        eq(users.userType, 'customer'),
        gte(customerBehaviorProfile.totalOrders, rule.minOrders),
      ];
      const rows = await ctx.db
        .select({ id: users.id })
        .from(users)
        .innerJoin(customerBehaviorProfile, eq(customerBehaviorProfile.userId, users.id))
        .where(and(...conds));
      return rows.map((r) => r.id);
    }

    default: {
      // exhaustive 检查
      const _exhaustive: never = rule;
      void _exhaustive;
      return [];
    }
  }
}

// ──────────────────── decideChannels(纯函数) ────────────────────

const CATEGORY_PREF_KEY = {
  promo: 'promoEnabled',
  system: 'orderStatusEnabled',
} as const;

/**
 * 决定一个 user 该往哪些渠道投递
 * - bypassUserPrefs=true 强制 in_app + web_push(不读 prefs)
 * - 否则:in_app 总投 · web_push 看用户类目偏好 + level + quiet hour
 * - level='silent' 永不 web_push
 *
 * 纯函数 · 易测
 */
export function decideChannels(args: {
  prefs: UserPushPreference | null;
  level: 'critical' | 'important' | 'info' | 'silent';
  category: 'promo' | 'system';
  bypassUserPrefs: boolean;
  now?: Date;
}): string[] {
  const channels: string[] = ['in_app'];
  if (args.bypassUserPrefs) {
    if (args.level !== 'silent') channels.push('web_push');
    return channels;
  }
  if (args.level === 'silent') return channels;
  if (!args.prefs) {
    // 用户没建 prefs 行 · 默认全开
    channels.push('web_push');
    return channels;
  }
  const prefKey = CATEGORY_PREF_KEY[args.category];
  const categoryAllowed = args.prefs[prefKey] === 1;
  if (!categoryAllowed) return channels;
  // quiet hour:critical 穿透 · 其他不投 web_push
  if (args.level === 'critical') {
    channels.push('web_push');
    return channels;
  }
  const inQuiet = inQuietHour(args.prefs, args.now ?? new Date());
  if (inQuiet && (args.level === 'info' || args.level === 'important')) return channels;
  channels.push('web_push');
  return channels;
}

function inQuietHour(prefs: UserPushPreference, now: Date): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const start = parseHHmm(prefs.quietHoursStart);
  const end = parseHHmm(prefs.quietHoursEnd);
  if (start === null || end === null) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (start < end) return mins >= start && mins < end;
  // 跨夜(22:00-07:00)
  return mins >= start || mins < end;
}

function parseHHmm(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

// ──────────────────── enqueueBatch ────────────────────

interface BatchArgs {
  broadcastId: string;
  recipientUserIds: string[];
  title: string;
  body?: string | null;
  bodyTranslations?: Record<string, { title: string; body?: string }> | null;
  level: 'critical' | 'important' | 'info' | 'silent';
  category: 'promo' | 'system';
  deepLink?: string | null;
  bypassUserPrefs: boolean;
}

interface BatchResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * 一批 user 同步 insert notifications + deliveries
 * 分 chunk 500/批 · 失败该 chunk 标 failed 不影响其他
 */
export async function enqueueBatch(ctx: NotifyContext, args: BatchArgs): Promise<BatchResult> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // 切 chunk
  const chunks: string[][] = [];
  for (let i = 0; i < args.recipientUserIds.length; i += CHUNK_SIZE) {
    chunks.push(args.recipientUserIds.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    try {
      // 1. 拉这批用户的 prefs(一次 SELECT IN · 避免 N+1)
      const prefsList = await ctx.db
        .select()
        .from(userPushPreferences)
        .where(inArray(userPushPreferences.userId, chunk));
      const prefsByUser = new Map<string, UserPushPreference>();
      for (const p of prefsList) prefsByUser.set(p.userId, p);

      // 2. 逐 user 决策渠道 · 准备 insert rows
      const notifRows: NewNotification[] = [];
      const sentUsers: string[] = [];
      const skippedUsers: { userId: string; reason: string }[] = [];

      for (const userId of chunk) {
        const prefs = prefsByUser.get(userId) ?? null;
        const channels = decideChannels({
          prefs,
          level: args.level,
          category: args.category,
          bypassUserPrefs: args.bypassUserPrefs,
        });
        // channels 至少有 in_app → 必投
        notifRows.push({
          recipientUserId: userId,
          level: args.level,
          category: args.category,
          title: args.title,
          body: args.body ?? null,
          bodyTranslations: (args.bodyTranslations as unknown as Record<string, string>) ?? null,
          deepLink: args.deepLink ?? null,
          channels,
          pushedAt: {},
        });
        sentUsers.push(userId);
      }

      // 3. 批量 insert notifications · 返 id
      const inserted = notifRows.length
        ? await ctx.db.insert(notifications).values(notifRows).returning({ id: notifications.id, userId: notifications.recipientUserId })
        : [];
      const notifIdByUser = new Map<string, string>();
      for (const row of inserted) notifIdByUser.set(row.userId, row.id);

      // 4. 批量 insert deliveries
      const delivRows: NewNotificationBroadcastDelivery[] = [];
      for (const userId of sentUsers) {
        delivRows.push({
          broadcastId: args.broadcastId,
          recipientUserId: userId,
          notificationId: notifIdByUser.get(userId) ?? null,
          status: 'sent',
          skipReason: null,
        });
      }
      for (const s of skippedUsers) {
        delivRows.push({
          broadcastId: args.broadcastId,
          recipientUserId: s.userId,
          notificationId: null,
          status: 'skipped',
          skipReason: s.reason,
        });
      }
      if (delivRows.length) {
        await ctx.db.insert(notificationBroadcastDeliveries).values(delivRows).onConflictDoNothing();
      }
      sent += sentUsers.length;
      skipped += skippedUsers.length;
    } catch (err) {
      logger.error('broadcast.chunk_failed', {
        broadcastId: args.broadcastId,
        chunkSize: chunk.length,
        err: err instanceof Error ? err.message : String(err),
      });
      // 该 chunk 全标 failed
      try {
        const failedRows = chunk.map((userId) => ({
          broadcastId: args.broadcastId,
          recipientUserId: userId,
          notificationId: null as string | null,
          status: 'failed' as const,
          skipReason: 'chunk_error',
        }));
        await ctx.db.insert(notificationBroadcastDeliveries).values(failedRows).onConflictDoNothing();
      } catch {
        // 兜底失败也不抛
      }
      failed += chunk.length;
    }
  }

  return { sent, skipped, failed };
}

// ──────────────────── runBroadcast ────────────────────

/**
 * 接管整个发送流程
 * mark sending → resolve → batch insert → mark completed
 * 异常 → mark failed + log
 */
export async function runBroadcast(ctx: NotifyContext, broadcastId: string): Promise<void> {
  const bc = await ctx.db.query.notificationBroadcasts.findFirst({
    where: eq(notificationBroadcasts.id, broadcastId),
  });
  if (!bc) {
    logger.error('broadcast.not_found', { broadcastId });
    return;
  }
  if (bc.status !== 'draft') {
    logger.error('broadcast.invalid_status', { broadcastId, status: bc.status });
    return;
  }

  // 1. mark sending
  await ctx.db
    .update(notificationBroadcasts)
    .set({ status: 'sending', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(notificationBroadcasts.id, broadcastId));

  try {
    // 2. resolve audience(以 audience_rule 重算 · 不信草稿期 audience_count)
    const audience = await resolveAudience(ctx, bc.audienceRule);

    // 3. batch insert
    const { sent, skipped, failed } = await enqueueBatch(ctx, {
      broadcastId,
      recipientUserIds: audience,
      title: bc.title,
      body: bc.body,
      bodyTranslations: bc.bodyTranslations as Record<string, { title: string; body?: string }> | null,
      level: bc.level as 'critical' | 'important' | 'info' | 'silent',
      category: bc.category as 'promo' | 'system',
      deepLink: bc.deepLink,
      bypassUserPrefs: bc.bypassUserPrefs === 1,
    });

    // 4. mark completed
    await ctx.db
      .update(notificationBroadcasts)
      .set({
        status: 'completed',
        completedAt: new Date(),
        sentCount: sent,
        skippedCount: skipped,
        failedCount: failed,
        audienceCount: audience.length,
        updatedAt: new Date(),
      })
      .where(eq(notificationBroadcasts.id, broadcastId));
  } catch (err) {
    logger.error('broadcast.run_failed', {
      broadcastId,
      err: err instanceof Error ? err.message : String(err),
    });
    await ctx.db
      .update(notificationBroadcasts)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(notificationBroadcasts.id, broadcastId));
  }
}

// ──────────────────── preview-audience ────────────────────

/**
 * 计算受众 + 取前 10 个样本 · admin 预览用
 */
export async function previewAudience(
  ctx: NotifyContext,
  rule: AudienceRule,
): Promise<{ count: number; sample: Array<{ id: string; displayName: string | null; userType: string }> }> {
  const ids = await resolveAudience(ctx, rule);
  if (ids.length === 0) return { count: 0, sample: [] };
  const sampleIds = ids.slice(0, 10);
  const sample = await ctx.db
    .select({ id: users.id, displayName: users.displayName, userType: users.userType })
    .from(users)
    .where(inArray(users.id, sampleIds));
  return { count: ids.length, sample };
}

// 抑制 lte 警告(预留 Phase 1 用 scheduledAt 过滤)
void lte;
void sql;
