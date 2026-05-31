'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiGet, apiPatch, clearTokens, getAccessToken, saveTokens } from './api';
import { ErrorCode } from '@loverush/types';
import {
  hasLock,
  isWithinUnlockWindow,
  markUnlocked,
  setupLock,
  getUserMeta,
} from './lock';
import { PinGate } from '@/components/PinGate';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export interface CurrentUser {
  id: string;
  userType: 'customer' | 'therapist';
  displayName: string | null;
  avatarUrl: string | null;
  locale?: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  setLocale: (locale: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: () => {},
  setLocale: async () => {},
});

/** 启动同步读 cached user(乐观渲染 · 避免等 1.5s 跨洲 /me 才显示) */
function readCachedUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = window.localStorage.getItem('current_user');
    if (!cached) return null;
    return JSON.parse(cached) as CurrentUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // ⚡ 性能修复(2026-05-31):
  //   之前 mount 后才 fetch /me(2 个跨洲 RTT = 1.5-2s)期间所有页 loading=true 白屏。
  //   现在:启动同步读 localStorage 缓存的 user · 立刻渲染 · 后台静默 refresh。
  //   感知 TTI 直接 -1500ms(已登录回访场景)。
  const [user, setUser] = useState<CurrentUser | null>(() => readCachedUser());
  const [loading, setLoading] = useState<boolean>(() => readCachedUser() === null);
  const [locked, setLocked] = useState(false);

  const refresh = useCallback(async () => {
    // ── 关浏览器再开的"长期登录":access_token 过期(1h)后,只要 refresh_token(30d)还在,
    //    就主动续命一次,而不是直接判定为"未登录"。
    if (!getAccessToken()) {
      const refreshTok = typeof window !== 'undefined'
        ? window.localStorage.getItem('refresh_token')
        : null;
      if (refreshTok) {
        try {
          const r = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshTok }),
          });
          if (r.ok) {
            const j = (await r.json()) as { data?: { access_token?: string; refresh_token?: string } };
            const newAccess = j?.data?.access_token;
            const newRefresh = j?.data?.refresh_token;
            if (newAccess && newRefresh) {
              window.localStorage.setItem('access_token', newAccess);
              window.localStorage.setItem('refresh_token', newRefresh);
              // 续命成功 · 让下面的 /me 流程继续
            }
          }
        } catch {
          // 网络失败 · 走下面的"没 access_token"分支
        }
      }
    }

    if (!getAccessToken()) {
      // 续命失败 · 没 access_token:有 PIN 锁就上锁屏(信任窗口内除外),否则按未登录走
      if (hasLock() && !isWithinUnlockWindow()) {
        setLocked(true);
      } else {
        setLocked(false);
      }
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiGet<{
        user: {
          id: string;
          user_type: 'customer' | 'therapist';
          display_name: string | null;
          avatar_url: string | null;
          locale: string;
        };
      }>('/me');
      const u: CurrentUser = {
        id: me.user.id,
        userType: me.user.user_type,
        displayName: me.user.display_name,
        avatarUrl: me.user.avatar_url,
        locale: me.user.locale,
      };
      setUser(u);
      setLocked(false); // 鉴权 OK,清锁屏标志
      window.localStorage.setItem('current_user', JSON.stringify(u)); // 缓存，供瞬时错误兜底
    } catch (err) {
      // 只有「真·鉴权失效」(401 / E1001) 才登出；瞬时错误(500/网络)保留会话，不把已登录用户踢出
      if (err instanceof ApiClientError && err.payload.code === ErrorCode.E1001_OTP_INVALID) {
        clearTokens();
        window.localStorage.removeItem('current_user');
        setUser(null);
        // token 真失效后,如果本机有 PIN 锁,转上锁屏让用户重新解锁(避免被踢回登录页)
        if (hasLock() && !isWithinUnlockWindow()) {
          setLocked(true);
        }
      } else {
        const cached = window.localStorage.getItem('current_user');
        if (cached) {
          try {
            setUser(JSON.parse(cached) as CurrentUser);
          } catch {
            /* 缓存损坏则忽略，保留 token 不强制登出 */
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 切换偏好语言 · 持久化到后端 + AuthContext + localStorage
  const setLocale = useCallback(async (locale: string) => {
    try {
      await apiPatch<{ locale: string }>('/me/locale', { locale });
    } catch {
      // 网络失败也允许本地切换 · 下次进来再同步
    }
    setUser((prev) => (prev ? { ...prev, locale } : prev));
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('locale', locale);
        // 同步缓存的 current_user(避免下次进站读老 locale)
        const cached = window.localStorage.getItem('current_user');
        if (cached) {
          const u = JSON.parse(cached) as CurrentUser;
          window.localStorage.setItem('current_user', JSON.stringify({ ...u, locale }));
        }
      } catch {
        // 静默
      }
    }
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('current_user');
    }
    setUser(null);
    setLocked(false);
    router.replace('/');
  }, [router]);

  // PIN 解锁成功的回调:用解出的 refresh_token 续 access_token,同 PIN 重写 blob
  const onPinUnlock = useCallback(
    async ({ mnemonic, refreshToken, pin }: { mnemonic: string; refreshToken: string; pin: string }) => {
      try {
        const r = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const j = (await r.json()) as { data?: { access_token?: string; refresh_token?: string } };
        const newAccess = j?.data?.access_token;
        const newRefresh = j?.data?.refresh_token;
        if (!newAccess || !newRefresh) {
          // 服务端拒了 refresh(会话撤销/账户被封等):转助记词恢复
          router.replace('/recover');
          return;
        }
        saveTokens(newAccess, newRefresh);
        const meta = getUserMeta();
        if (meta) {
          // refresh 轮换:用同一 PIN 重新封 blob,保持下次解锁可用
          await setupLock({ pin, mnemonic, refreshToken: newRefresh, meta });
        }
        markUnlocked();
        setLocked(false);
        await refresh();
      } catch {
        router.replace('/recover');
      }
    },
    [refresh, router],
  );

  // 锁屏分支:UI 完全替换为 PinGate(AuthContext 仍提供以避免子组件 crash)
  if (locked && !user) {
    return (
      <AuthContext.Provider value={{ user, loading, refresh, logout, setLocale }}>
        <PinGate onUnlock={onPinUnlock} />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={{ user, loading, refresh, logout, setLocale }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function setCurrentUser(u: CurrentUser) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('current_user', JSON.stringify(u));
  }
}
