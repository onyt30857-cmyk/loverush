/**
 * Sentry 错误监控 · Phase 11.1
 *
 * 用法：服务启动时调 initSentry()，errorHandler 中间件已经会自动 captureException。
 * 无 SENTRY_DSN 时所有 API 都 noop（不抛错），生产配上 DSN 即可生效。
 *
 * 注意：Cloudflare Workers 不支持 @sentry/node，部署到 Workers 时改用 @sentry/cloudflare 或 Toucan。
 *       目前 LoveRush API 推荐跑 Bun on Vultr · @sentry/node 兼容。
 */

import { loadEnv } from '../env';
import { logger } from './logger';

let initialized = false;
let sentryModule: typeof import('@sentry/node') | null = null;

async function getSentry(): Promise<typeof import('@sentry/node') | null> {
  if (initialized) return sentryModule;
  initialized = true;

  const env = loadEnv() as unknown as {
    SENTRY_DSN?: string;
    SENTRY_ENVIRONMENT?: string;
    SENTRY_TRACES_SAMPLE_RATE: number;
    SENTRY_RELEASE?: string;
    NODE_ENV: string;
  };

  if (!env.SENTRY_DSN) return null;

  try {
    sentryModule = await import('@sentry/node');
    sentryModule.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: env.SENTRY_RELEASE,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
      // 不发送任何 IP / 请求体（隐私）
      sendDefaultPii: false,
      // 过滤掉业务正常的 4xx 错误码（401/403/404）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeSend: ((event: any, hint: any) => {
        const ex = hint?.originalException as { status?: number } | undefined;
        if (ex?.status && ex.status >= 400 && ex.status < 500) {
          return null; // 4xx 不上报
        }
        return event;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    });
    logger.info('sentry initialized');
    return sentryModule;
  } catch (err) {
    logger.warn('sentry init failed', { err });
    return null;
  }
}

export async function captureException(
  err: unknown,
  context?: { userId?: string; requestId?: string; path?: string; method?: string },
): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sentry.withScope((scope: any) => {
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context?.requestId) scope.setTag('request_id', context.requestId);
    if (context?.path) scope.setTag('path', context.path);
    if (context?.method) scope.setTag('method', context.method);
    sentry.captureException(err);
  });
}

/** 启动时调（main 入口）· 提前初始化避免首请求延迟 */
export async function initSentry(): Promise<void> {
  await getSentry();
}
