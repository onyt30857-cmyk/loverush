/**
 * Web Push 真实发送 · Phase 6.4
 *
 * 用 web-push npm 包 + VAPID 密钥对发推送。
 *
 * 部署提示：
 *   - 推荐跑在 Bun on Vultr（apps/api 同进程）· web-push 依赖 Node crypto
 *   - Cloudflare Workers 不直接兼容 web-push npm，需要 wrangler nodejs_compat 启用，
 *     或把通知发送拆为独立 worker 服务 → Cloudflare Queue → 外部 Bun 工人消费
 *
 * 生成 VAPID 密钥：
 *   $ npx web-push generate-vapid-keys
 *   把 publicKey / privateKey 填入 .env
 *
 * 失败处理：
 *   - 410 Gone / 404 → 标 webPushSubscriptions.isActive = 0（端点失效）
 *   - 429 / 5xx → 记 failureCount，连续 3 次失败也禁用
 *   - 其他 → 记日志不阻塞
 */

import { eq, sql } from 'drizzle-orm';
import { Database, webPushSubscriptions } from '@loverush/db';
import { loadEnv } from '../env';
import { logger } from './logger';

export interface WebPushContext {
  db: Database;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  badge?: string;
  icon?: string;
}

let webPushModule: typeof import('web-push') | null = null;
let initialized = false;

async function initWebPush(): Promise<typeof import('web-push') | null> {
  if (initialized) return webPushModule;
  initialized = true;

  const env = loadEnv() as unknown as {
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  };

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    logger.warn('web-push VAPID keys not configured, using stub');
    return null;
  }

  try {
    const mod = await import('web-push');
    mod.default.setVapidDetails(
      env.VAPID_SUBJECT ?? 'mailto:noreply@loverush.com',
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    webPushModule = mod;
    return mod;
  } catch (err) {
    logger.warn('web-push module load failed, falling back to stub', { err });
    return null;
  }
}

/** 单端点发送 · 失败自动标记 */
export async function sendToEndpoint(
  ctx: WebPushContext,
  args: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    payload: PushPayload;
  },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const mod = await initWebPush();
  if (!mod) {
    logger.info('web_push_stub', {
      userId: args.userId,
      endpoint: args.endpoint,
      payload: args.payload,
    });
    return { ok: false, error: 'stub_no_vapid' };
  }

  try {
    await mod.sendNotification(
      { endpoint: args.endpoint, keys: { p256dh: args.p256dh, auth: args.auth } },
      JSON.stringify(args.payload),
      { TTL: 60 * 60 * 24 },
    );

    await ctx.db
      .update(webPushSubscriptions)
      .set({ lastSeenAt: new Date(), failureCount: 0 })
      .where(eq(webPushSubscriptions.endpoint, args.endpoint));

    return { ok: true };
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;

    if (status === 410 || status === 404) {
      // 端点彻底失效
      await ctx.db
        .update(webPushSubscriptions)
        .set({ isActive: 0 })
        .where(eq(webPushSubscriptions.endpoint, args.endpoint));
      return { ok: false, status, error: 'endpoint_gone' };
    }

    // 其他错误：累计 failureCount，连续 3 次禁用
    const [updated] = await ctx.db
      .update(webPushSubscriptions)
      .set({ failureCount: sql`${webPushSubscriptions.failureCount} + 1` })
      .where(eq(webPushSubscriptions.endpoint, args.endpoint))
      .returning({ failureCount: webPushSubscriptions.failureCount });

    if (updated && updated.failureCount >= 3) {
      await ctx.db
        .update(webPushSubscriptions)
        .set({ isActive: 0 })
        .where(eq(webPushSubscriptions.endpoint, args.endpoint));
    }

    return { ok: false, status, error: String((err as Error).message ?? err) };
  }
}

/** 给用户的所有活跃订阅推送 */
export async function sendToUser(
  ctx: WebPushContext,
  args: { userId: string; payload: PushPayload },
): Promise<{ sent: number; failed: number }> {
  const subs = await ctx.db.query.webPushSubscriptions.findMany({
    where: (s, { and, eq }) => and(eq(s.userId, args.userId), eq(s.isActive, 1)),
  });
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    const r = await sendToEndpoint(ctx, {
      userId: args.userId,
      endpoint: s.endpoint,
      p256dh: s.p256dhKey,
      auth: s.authKey,
      payload: args.payload,
    });
    if (r.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
