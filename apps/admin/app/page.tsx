'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, saveAdminTokens, ApiClientError } from '@/lib/api';

interface RecoverResponse {
  user: { id: string; user_type: string; display_name: string | null };
  access_token: string;
  refresh_token: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 24) {
      setError('请输入完整的 24 个助记词');
      return;
    }
    setBusy(true);
    try {
      const data = await api.post<RecoverResponse>('/auth/recover', { mnemonic: words.join(' ') });
      saveAdminTokens(data.access_token, data.refresh_token);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="card w-full max-w-md">
        <h1 className="text-xl font-bold text-primary">LoveRush · Admin 登录</h1>
        <p className="mt-1 text-xs text-ink-500">仅持有后台角色的账号可进入。用助记词登录。</p>

        <textarea
          className="mt-5 h-32 w-full resize-none rounded-lg border border-ink-100 bg-white p-3 text-sm leading-6"
          placeholder="word1 word2 word3 ... word24"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
        />

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <button type="button" onClick={() => void login()} disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? '登录中…' : '进入后台'}
        </button>
      </div>
    </main>
  );
}
