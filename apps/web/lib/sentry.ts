/**
 * Sentry · 浏览器侧 · Phase 11.1
 *
 * 用法：在 layout.tsx 挂载时调 initBrowserSentry()。
 * 缺 NEXT_PUBLIC_SENTRY_DSN 时所有 API noop。
 */

// 为类型注解使用,运行时仍走动态 import (因 @sentry/nextjs 是可选依赖)
type SentryModule = typeof import('@sentry/nextjs');

let initialized = false;
let mod: SentryModule | null = null;

export async function initBrowserSentry(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (initialized) return;
  initialized = true;

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  try {
    mod = await import('@sentry/nextjs');
    mod.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      sendDefaultPii: false,
      // 隐私模式开启时拦截上报
      beforeSend(event) {
        if (typeof window !== 'undefined' && window.localStorage.getItem('privacy_mode_blocked') === '1') {
          return null;
        }
        return event;
      },
    });
  } catch (err) {
    console.warn('[sentry] init failed:', err);
  }
}

export function captureClientError(err: unknown, context?: Record<string, unknown>): void {
  if (!mod) return;
  mod.captureException(err, { extra: context });
}
