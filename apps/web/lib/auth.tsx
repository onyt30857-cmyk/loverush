'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, clearTokens, getAccessToken } from './api';

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
      setUser({
        id: me.user.id,
        userType: me.user.user_type,
        displayName: me.user.display_name,
        locale: me.user.locale,
      });
    } catch {
      clearTokens();
      window.localStorage.removeItem('current_user');
      setUser(null);
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
