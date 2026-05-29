/**
 * 通知服务 · M13
 *
 * - enqueue：写 notifications + 按用户 prefs 触发 fan-out（in_app 总有 / web_push 按订阅）
 * - listForUser：分页 + 未读优先
 * - markRead / markAllRead
 * - updatePreferences / subscribeWebPush
 *
 * Web Push 实际发送暂用 stub（log "would send"），Phase 6 接入 web-push npm + VAPID。
 */

import { and, eq, desc, isNull, inArray, sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  notifications,
  userPushPreferences,
  webPushSubscriptions,
  type Notification,
  type UserPushPreference,
} from '@loverush/db';
import { fireAndForget } from './logger';

export interface NotifyContext {
  db: Database;
}

export type Category =
  | 'chat_msg'
  | 'order_status'
  | 'dispatch_offer'
  | 'review'
  | 'withdraw'
  | 'system'
  | 'promo';

export type Level = 'critical' | 'important' | 'info' | 'silent';

export interface EnqueueArgs {
  recipientUserId: string;
  level?: Level;
  category: Category;
  title: string;
  body?: string;
  bodyTranslations?: Record<string, string>;
  deepLink?: string;
  refType?: string;
  refId?: string;
  expiresAt?: Date;
}

const CATEGORY_PREF_KEY: Record<Category, keyof UserPushPreference> = {
  chat_msg: 'chatMsgEnabled',
  order_status: 'orderStatusEnabled',
  dispatch_offer: 'dispatchOfferEnabled',
  review: 'reviewEnabled',
  withdraw: 'withdrawEnabled',
  system: 'orderStatusEnabled', // 重要系统消息走 orderStatus 开关
  promo: 'promoEnabled',
};

function isQuietHour(prefs: UserPushPreference, now = new Date()): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const [sh, sm] = prefs.quietHoursStart.split(':').map(Number);
  const [eh, em] = prefs.quietHoursEnd.split(':').map(Number);
  if (sh == null || sm == null || eh == null || em == null) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // 跨夜
}

export async function enqueue(ctx: NotifyContext, args: EnqueueArgs): Promise<Notification> {
  const level = args.level ?? 'info';

  // 读 prefs
  const prefs = await ctx.db.query.userPushPreferences.findFirst({
    where: eq(userPushPreferences.userId, args.recipientUserId),
  });

  // 渠道决策
  const channels: string[] = ['in_app'];
  const categoryAllowed = !prefs || prefs[CATEGORY_PREF_KEY[args.category]] === 1;
  const quiet = prefs ? isQuietHour(prefs) : false;
  const shouldPush = categoryAllowed && level !== 'silent' && !(quiet && level === 'info');

  if (shouldPush) channels.push('web_push');

  const [row] = await ctx.db
    .insert(notifications)
    .values({
      recipientUserId: args.recipientUserId,
      level,
      category: args.category,
      title: args.title,
      body: args.body,
      bodyTranslations: args.bodyTranslations,
      deepLink: args.deepLink,
      refType: args.refType,
      refId: args.refId,
      channels,
      expiresAt: args.expiresAt,
    })
    .returning();
  if (!row) throw new Error('notification insert failed');

  if (shouldPush) {
    fireAndForget(
      sendWebPushFanout(ctx, row, prefs?.obfuscatePreviews === 1),
      'webpush.fanout_failed',
      { notificationId: row.id, recipientUserId: row.recipientUserId },
    );
  }

  // M05 Phase 2 · SSE 实时推送(在线用户)· home Bell 红点立刻变
  try {
    const { publishToUser } = await import('./sse-hub');
    publishToUser(row.recipientUserId, 'notification_new', {
      id: row.id,
      category: row.category,
      level: row.level,
      title: row.title,
      createdAt: row.createdAt,
    });
  } catch {
    // sse-hub 失败不阻塞主链
  }

  return row;
}

async function sendWebPushFanout(
  ctx: NotifyContext,
  notif: Notification,
  obfuscatePreviews: boolean,
): Promise<void> {
  const payload = obfuscatePreviews
    ? { title: '新消息', body: '点击查看', url: notif.deepLink ?? '/', tag: notif.id }
    : { title: notif.title, body: notif.body ?? '', url: notif.deepLink ?? '/', tag: notif.id };

  // 接入 web-push 真发（无 VAPID 时自动 stub log）
  const wp = await import('./web-push');
  await wp.sendToUser({ db: ctx.db }, { userId: notif.recipientUserId, payload });

  await ctx.db
    .update(notifications)
    .set({ pushedAt: { ...(notif.pushedAt ?? {}), web_push: new Date().toISOString() } })
    .where(eq(notifications.id, notif.id));
}

// ──────────────── 列表 / 标记 ────────────────

export async function listForUser(
  ctx: NotifyContext,
  args: { userId: string; unreadOnly?: boolean; limit?: number; offset?: number },
): Promise<Notification[]> {
  const conds = [eq(notifications.recipientUserId, args.userId)];
  if (args.unreadOnly) conds.push(isNull(notifications.readAt));
  return ctx.db.query.notifications.findMany({
    where: and(...conds),
    orderBy: [desc(notifications.createdAt)],
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  });
}

export async function markRead(
  ctx: NotifyContext,
  args: { userId: string; notificationIds: string[] },
): Promise<number> {
  if (!args.notificationIds.length) return 0;
  const result = await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientUserId, args.userId),
        inArray(notifications.id, args.notificationIds),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return result.length;
}

export async function markAllRead(ctx: NotifyContext, userId: string): Promise<number> {
  const result = await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length;
}

// ──────────────── 偏好 ────────────────

export interface PrefPatch {
  chatMsgEnabled?: boolean;
  orderStatusEnabled?: boolean;
  dispatchOfferEnabled?: boolean;
  reviewEnabled?: boolean;
  withdrawEnabled?: boolean;
  promoEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  obfuscatePreviews?: boolean;
}

export async function updatePreferences(
  ctx: NotifyContext,
  args: { userId: string; patch: PrefPatch },
): Promise<UserPushPreference> {
  const toIntBool = (v?: boolean) => (v === undefined ? undefined : v ? 1 : 0);
  const data = {
    chatMsgEnabled: toIntBool(args.patch.chatMsgEnabled),
    orderStatusEnabled: toIntBool(args.patch.orderStatusEnabled),
    dispatchOfferEnabled: toIntBool(args.patch.dispatchOfferEnabled),
    reviewEnabled: toIntBool(args.patch.reviewEnabled),
    withdrawEnabled: toIntBool(args.patch.withdrawEnabled),
    promoEnabled: toIntBool(args.patch.promoEnabled),
    quietHoursStart: args.patch.quietHoursStart,
    quietHoursEnd: args.patch.quietHoursEnd,
    obfuscatePreviews: toIntBool(args.patch.obfuscatePreviews),
    updatedAt: new Date(),
  };

  // 过滤 undefined
  const cleaned: Record<string, unknown> = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  );

  const [row] = await ctx.db
    .insert(userPushPreferences)
    .values({ userId: args.userId, ...cleaned })
    .onConflictDoUpdate({ target: userPushPreferences.userId, set: cleaned })
    .returning();
  return row!;
}

export async function subscribeWebPush(
  ctx: NotifyContext,
  args: { userId: string; endpoint: string; p256dhKey: string; authKey: string; userAgent?: string },
): Promise<void> {
  await ctx.db
    .insert(webPushSubscriptions)
    .values({
      userId: args.userId,
      endpoint: args.endpoint,
      p256dhKey: args.p256dhKey,
      authKey: args.authKey,
      userAgent: args.userAgent,
    })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpoint,
      set: { userId: args.userId, isActive: 1, lastSeenAt: new Date() },
    });
}

export async function unsubscribeWebPush(
  ctx: NotifyContext,
  args: { userId: string; endpoint: string },
): Promise<void> {
  await ctx.db
    .update(webPushSubscriptions)
    .set({ isActive: 0 })
    .where(and(eq(webPushSubscriptions.userId, args.userId), eq(webPushSubscriptions.endpoint, args.endpoint)));
}
