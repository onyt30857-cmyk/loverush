'use client';

import { useEffect } from 'react';
import { initBrowserSentry } from '@/lib/sentry';

/**
 * Sentry 浏览器端初始化(性能修复:requestIdleCallback 延后)
 *   - Sentry SDK ~100KB JS · 解析占 main thread 100-200ms
 *   - 让 hydration + 首屏交互优先 · 用 requestIdleCallback 在浏览器空闲时启动
 *   - fallback:不支持 rIC 的浏览器降级 setTimeout 1500ms 后
 */
export default function SentryInit() {
  useEffect(() => {
    const start = () => {
      void initBrowserSentry();
    };
    if (typeof window === 'undefined') return;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) {
      ric(start, { timeout: 3000 });
    } else {
      setTimeout(start, 1500);
    }
  }, []);
  return null;
}
