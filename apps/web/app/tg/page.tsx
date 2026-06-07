'use client';

/**
 * M17 · Telegram Mini App 入口
 *
 * 在 TG 内打开时：注入 telegram-web-app.js → 取 initData → POST /auth/telegram 验签换 token
 * → 存 token → 跳 /home（完整 App）。非 TG 环境打开则提示。
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, saveTokens } from '@/lib/api';

interface TgWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
}

/**
 * 深链落点 · start_param 决定登录后跳哪
 *   t_<therapistId> → 技师详情页(inline 卡「打开/约」直达)
 *   其余/缺省       → /home
 */
function destFromStartParam(sp?: string): string {
  if (sp && /^t_[A-Za-z0-9-]{6,}$/.test(sp)) {
    return `/therapist/${encodeURIComponent(sp.slice(2))}`;
  }
  return '/home';
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const TG_SCRIPT = 'https://telegram.org/js/telegram-web-app.js';

function ensureTelegram(): Promise<TgWebApp | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
    const s = document.createElement('script');
    s.src = TG_SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.Telegram?.WebApp ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    // 兜底：脚本久不 load 也别卡死
    setTimeout(() => resolve(window.Telegram?.WebApp ?? null), 4000);
  });
}

export default function TgEntryPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'outside' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const wa = await ensureTelegram();
      if (cancelled) return;
      if (!wa || !wa.initData) {
        setState('outside');
        return;
      }
      try {
        wa.ready();
        wa.expand();
        wa.setHeaderColor?.('#FF5577');
        const r = await apiPost<{ access_token: string; refresh_token: string }>('/auth/telegram', {
          init_data: wa.initData,
        });
        saveTokens(r.access_token, r.refresh_token);
        if (cancelled) return;
        router.replace(destFromStartParam(wa.initDataUnsafe?.start_param));
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-8 text-center">
      {state === 'loading' && (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF5577] border-t-transparent" />
          <p className="text-sm text-[#6A7088]">正在进入…</p>
        </>
      )}
      {state === 'outside' && (
        <>
          <div className="text-4xl">💬</div>
          <h1 className="text-base font-semibold text-[#1A1A2E]">请在 Telegram 里打开</h1>
          <p className="max-w-xs text-sm text-[#6A7088]">
            这个页面需要从 Telegram 的机器人里打开。回到 Telegram，点机器人下方的「打开 App」按钮即可。
          </p>
        </>
      )}
      {state === 'error' && (
        <>
          <div className="text-4xl">😵</div>
          <h1 className="text-base font-semibold text-[#1A1A2E]">登录失败</h1>
          <p className="max-w-xs text-sm text-[#6A7088]">请退出后重新从机器人打开，或稍后再试。</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-2 rounded-lg bg-[#FF5577] px-4 py-2 text-sm font-medium text-white"
          >
            重试
          </button>
        </>
      )}
    </div>
  );
}
