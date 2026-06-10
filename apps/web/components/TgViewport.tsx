'use client';

/**
 * M17 · Telegram Mini App 视口初始化(全局)
 *
 * 在 TG 内:ready() + expand() 让 webview 占满 → telegram-web-app.js 维护
 * --tg-viewport-stable-height 变量;给 <html> 加 is-tg 类,让 .mobile-container
 * 用真实可见高度(100vh ≠ TG 可见区,会把 sticky 底部导航顶到屏幕外)。
 *
 * ⚠️ 客户端路由跳转修复:进技师详情再 router.back() 回首页时,TG 视口状态会漂移,
 * 而原来 useEffect([]) 只在首次打开跑一次、不会随路由重跑 → 容器按陈旧高度算 →
 * sticky 底部导航被顶出可视区(表现为"返回首页后底部菜单栏消失")。
 * 改为每次 pathname 变化都重新 expand()/校正视口 + 触发 resize 让 sticky/高度重算。
 *
 * 非 TG 环境:window.Telegram.WebApp.initData 为空,直接 no-op。
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface TgWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (c: string) => void;
  disableVerticalSwipes?: () => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
}

function getWebApp(): TgWebApp | null {
  const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  // telegram-web-app.js 在任何浏览器都会建一个 WebApp stub,只有真·TG 里 initData 非空。
  // 否则别加 is-tg/别 expand(免影响普通网页)。
  return wa && wa.initData ? wa : null;
}

export default function TgViewport() {
  const pathname = usePathname();

  // ① ready() + 监听 TG 原生 viewportChanged(展开态/键盘变化)→ 强制 reflow,只绑一次
  useEffect(() => {
    const wa = getWebApp();
    if (!wa) return;
    try {
      wa.ready?.();
    } catch {
      /* 忽略 */
    }
    if (!wa.onEvent) return;
    const onViewportChanged = () => window.dispatchEvent(new Event('resize'));
    wa.onEvent('viewportChanged', onViewportChanged);
    return () => wa.offEvent?.('viewportChanged', onViewportChanged);
  }, []);

  // ② 每次路由变化都重新校正视口:重跑 expand() 刷新 --tg-viewport-stable-height,
  //    再下一帧 dispatch resize 强制 sticky/容器高度重算 → 修 back 回首页底部导航消失。
  useEffect(() => {
    const wa = getWebApp();
    if (!wa) return;
    try {
      wa.expand?.();
      wa.setHeaderColor?.('#FF5577');
      wa.disableVerticalSwipes?.(); // 防下滑误关 + 抢滚动
      document.documentElement.classList.add('is-tg');
      // expand() 触发的 viewportChanged 是异步的;下一帧再强制一次 reflow,
      // 让被路由缓存恢复 / 高度漂移后失稳的 sticky 底部导航重新归位。
      const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      return () => cancelAnimationFrame(raf);
    } catch {
      /* 老版本 TG 缺部分 API,忽略 */
    }
  }, [pathname]);

  return null;
}
