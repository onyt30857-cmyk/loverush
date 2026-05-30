'use client';

/**
 * Admin 登录页 · 对齐客户端 user_handle + password 体系
 *
 * - 字段:账号名(1-16 字符)+ 密码(8-32 字符)
 * - endpoint:/auth/login-simple(与客户端共用)
 * - 鉴权后端不区分 admin/customer/therapist,统一返 access+refresh token
 *   admin 入门要求:登录后 /me/roles 返回非空数组(AdminShell 强制校验)
 * - token 存隔离 key(admin_access_token / admin_refresh_token)防越权
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, saveAdminTokens, ApiClientError } from '@/lib/api';

interface LoginSimpleResponse {
  user: { id: string; user_type: string; user_handle: string; display_name: string | null };
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [userHandle, setUserHandle] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    const handle = userHandle.trim();
    if (!handle || !password) {
      setError('请填账号名 + 密码');
      return;
    }
    setBusy(true);
    try {
      const data = await api.post<LoginSimpleResponse>('/auth/login-simple', {
        user_handle: handle,
        password,
      });
      saveAdminTokens(data.access_token, data.refresh_token);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.payload.message || '账号或密码不正确');
      } else {
        setError(String((err as Error).message));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="card w-full max-w-md">
        <h1 className="text-xl font-bold text-primary">LoveRush · Admin 登录</h1>
        <p className="mt-1 text-xs text-ink-500">仅持有后台角色的账号可进入。账号名 + 密码。</p>

        <div className="mt-5 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-700">账号名</label>
            <input
              type="text"
              value={userHandle}
              onChange={(e) => setUserHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="例:admin01"
              autoComplete="username"
              autoCapitalize="none"
              onKeyDown={(e) => e.key === 'Enter' && void login()}
              className="w-full rounded-lg border border-ink-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-700">密码</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8-32 位"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && void login()}
                className="w-full rounded-lg border border-ink-100 bg-white px-3 py-2.5 pr-12 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                aria-label={showPwd ? '隐藏' : '显示'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-ink-500 hover:bg-ink-50"
              >
                {showPwd ? '隐藏' : '显示'}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <button
          type="button"
          onClick={() => void login()}
          disabled={busy}
          className="btn-primary mt-5 w-full"
        >
          {busy ? '登录中…' : '进入后台'}
        </button>

        <p className="mt-4 text-[11px] leading-5 text-ink-400">
          需要后台权限?让现有 admin 在 user_roles 表给你的账号加 'admin' 角色。
        </p>
      </div>
    </main>
  );
}
