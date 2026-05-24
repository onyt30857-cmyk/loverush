'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearTokens } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = window.localStorage.getItem('access_token');
    if (!t) router.replace('/');
    else setToken(t);
  }, [router]);

  function onLogout() {
    clearTokens();
    router.replace('/');
  }

  return (
    <main className="h5-shell">
      <h1 className="text-2xl font-bold">欢迎</h1>
      <p className="mt-2 text-sm text-ink-500">登录成功 · 后续模块开发中…</p>

      <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-4 text-xs">
        <div className="text-ink-500">Access Token</div>
        <div className="mt-1 break-all font-mono text-ink-900">{token?.slice(0, 80)}…</div>
      </div>

      <button type="button" className="btn-ghost mt-8" onClick={onLogout}>
        退出登录
      </button>
    </main>
  );
}
