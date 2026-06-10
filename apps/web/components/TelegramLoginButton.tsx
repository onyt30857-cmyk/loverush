'use client';

/**
 * Telegram Login Widget(H5 普通浏览器授权登录)
 *
 * 注入官方 telegram-widget.js → 渲染「用 Telegram 登录」按钮 → 授权回调拿用户数据
 * → POST /auth/telegram-widget 验签换 token → 登录成功跳转。
 *
 * ⚠️ 需在 BotFather `/setdomain` 把本站域名绑给 bot,否则按钮不渲染。
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, saveTokens, ApiClientError } from '@/lib/api';

interface TgWidgetUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface LoginResp {
  access_token: string;
  refresh_token: string;
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TG_BOT_USERNAME ?? 'loverush_bot';

export function TelegramLoginButton() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 授权回调(挂到 window 供 widget 调用)
    (window as unknown as { onTelegramAuth?: (u: TgWidgetUser) => void }).onTelegramAuth = (user) => {
      void (async () => {
        try {
          const data = await apiPost<LoginResp>('/auth/telegram-widget', user);
          saveTokens(data.access_token, data.refresh_token);
          const next = new URLSearchParams(window.location.search).get('next');
          router.replace(next && next.startsWith('/') ? next : '/home');
        } catch (err) {
          setError(err instanceof ApiClientError ? err.payload.message : 'Telegram 登录失败,请重试');
        }
      })();
    };

    // 注入 widget 脚本(只注一次)
    el.innerHTML = '';
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', BOT_USERNAME);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-userpic', 'false');
    s.setAttribute('data-request-access', 'write');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    el.appendChild(s);

    return () => {
      delete (window as unknown as { onTelegramAuth?: unknown }).onTelegramAuth;
    };
  }, [router]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div ref={containerRef} className="min-h-[40px]" />
      {error && <div className="text-[12px] text-rose-500">{error}</div>}
    </div>
  );
}
