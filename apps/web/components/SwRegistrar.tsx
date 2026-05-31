'use client';

import { useEffect } from 'react';
import { registerSW } from '@/lib/pwa';

/**
 * Service Worker 注册(性能修复:requestIdleCallback 延后)
 *   - SW register 本身不慢,但触发的 install/activate 占 main thread
 *   - 用 rIC 延后到浏览器空闲后注册,不阻塞首屏 hydration
 *   - fallback:不支持 rIC 的浏览器降级 setTimeout 2000ms 后
 */
export default function SwRegistrar() {
  useEffect(() => {
    const start = () => {
      void registerSW();
    };
    if (typeof window === 'undefined') return;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) {
      ric(start, { timeout: 4000 });
    } else {
      setTimeout(start, 2000);
    }
  }, []);
  return null;
}
