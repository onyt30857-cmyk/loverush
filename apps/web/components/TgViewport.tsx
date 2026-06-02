'use client';

/**
 * M17 · Telegram Mini App 视口初始化（全局）
 *
 * 在 TG 内：ready() + expand() 让 webview 占满 → telegram-web-app.js 维护
 * --tg-viewport-stable-height 变量；给 <html> 加 is-tg 类，让 .mobile-container
 * 用真实可见高度（100vh ≠ TG 可见区，会把 sticky 底部导航顶到屏幕外）。
 * 非 TG 环境：window.Telegram.WebApp 不存在，直接 no-op。
 */

import { useEffect } from 'react';

interface TgWebApp {
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (c: string) => void;
  disableVerticalSwipes?: () => void;
}

export default function TgViewport() {
  useEffect(() => {
    const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
    if (!wa) return;
    try {
      wa.ready?.();
      wa.expand?.();
      wa.setHeaderColor?.('#FF5577');
      wa.disableVerticalSwipes?.(); // 防下滑误关 + 抢滚动
      document.documentElement.classList.add('is-tg');
    } catch {
      /* 老版本 TG 缺部分 API，忽略 */
    }
  }, []);
  return null;
}
