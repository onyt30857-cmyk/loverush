'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, apiGet, clearTokens, getAccessToken } from './api';
import { ErrorCode } from '@loverush/types';

export interface CurrentUser {
  id: string;
  userType: 'customer' | 'therapist';
  displayName: string | null;
  locale?: string;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiGet<{
        user: { id: string; user_type: 'customer' | 'therapist'; display_name: string | null; locale: string };
      }>('/me');
      const u: CurrentUser = {
        id: me.user.id,
        userType: me.user.user_type,
        displayName: me.user.display_name,
        locale: me.user.locale,
      };
      setUser(u);
      window.localStorage.setItem('current_user', JSON.stringify(u)); // 缓存，供瞬时错误兜底
    } catch (err) {
      // 只有「真·鉴权失效」(401 / E1001) 才登出；瞬时错误(500/网络)保留会话，不把已登录用户踢出
      if (err instanceof ApiClientError && err.payload.code === ErrorCode.E1001_OTP_INVALID) {
        clearTokens();
        window.localStorage.removeItem('current_user');
        setUser(null);
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

  const logout = useCallback(() => {
    clearTokens();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('current_user');
    }
    setUser(null);
    router.replace('/');
  }, [router]);

  return <AuthContext.Provider value={{ user, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function setCurrentUser(u: CurrentUser) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('current_user', JSON.stringify(u));
  }
}
