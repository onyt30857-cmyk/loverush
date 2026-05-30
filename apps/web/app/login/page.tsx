'use client';

/**
 * 账号名 + 密码登录
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';

interface LoginResponse {
  user: { id: string; userType: 'customer' | 'therapist'; userHandle: string; displayName: string | null };
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

  async function submit() {
    setError(null);
    if (!userHandle.trim() || !password) {
      setError('请填账号名 + 密码');
      return;
    }
    setBusy(true);
    try {
      const data = await apiPost<LoginResponse>('/auth/login-simple', {
        user_handle: userHandle.trim(),
        password,
      });
      saveTokens(data.access_token, data.refresh_token);
      const target = data.user.userType === 'therapist' ? '/t/home' : '/home';
      if (typeof window !== 'undefined') {
        window.location.replace(target);
      } else {
        router.replace(target);
      }
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError) {
        setError(err.payload.message || '账号或密码不正确');
      } else {
        setError(String((err as Error).message));
      }
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      <div className="px-6 pt-10">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl heart-logo">
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
          <div className="font-serif-cn text-lg font-semibold">LoveRush</div>
        </div>
        <h1 className="mt-6 font-serif-cn text-[24px] font-semibold leading-tight">登录</h1>
        <p className="mt-1.5 text-[12px] text-ink-500">账号名 + 密码</p>
      </div>

      <div className="mt-6 space-y-4 px-6 pb-12">
        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">账号名</label>
          <input
            type="text"
            value={userHandle}
            onChange={(e) => setUserHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            placeholder="lily2026"
            autoComplete="username"
            autoCapitalize="none"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">密码</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8-32 位"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 pr-10 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
              aria-label={showPwd ? '隐藏' : '显示'}
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-[12px] text-primary">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-2 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta text-[16px] font-semibold text-white shadow-rose-lg active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? '登录中…' : '登录'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>

        <div className="text-center text-[12px] text-ink-500">
          没有账号?
          <Link href="/register/customer" className="ml-1 font-medium text-primary hover:underline">
            立即注册 →
          </Link>
        </div>

        {/* NN/G 可回访原则:让用户能回头看产品介绍 */}
        <div className="text-center pt-4">
          <Link
            href="/?welcome=1"
            className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
          >
            看产品介绍 →
          </Link>
        </div>
      </div>
    </div>
  );
}
