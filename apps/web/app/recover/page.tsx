'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';
import { deriveStaticKeyPair, storeKeyPair } from '@/lib/crypto';

interface RecoverResponse {
  user: { id: string; user_type: string; display_name: string | null };
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export default function RecoverPage() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = mnemonic.trim() ? mnemonic.trim().split(/\s+/).length : 0;

  async function onSubmit() {
    setError(null);
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 24) {
      setError('请输入完整的 24 个助记词，用空格分隔');
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<RecoverResponse>('/auth/recover', {
        mnemonic: words.join(' '),
      });
      saveTokens(data.access_token, data.refresh_token);

      try {
        const kp = await deriveStaticKeyPair(words.join(' '));
        await storeKeyPair(kp);
        await apiPost('/me/encryption-key', {
          algorithm: 'x25519',
          public_key: kp.publicKeyB64,
        });
      } catch (e) {
        console.warn('[crypto] key restore failed:', e);
      }

      router.push('/discover');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(`${err.payload.code} · ${err.payload.message}`);
      } else {
        setError(String((err as Error).message));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <header className="flex h-14 items-center px-4">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95"
        >
          ←
        </Link>
      </header>

      <div className="px-6 pb-10 animate-fade-up">
        <div className="gradient-orb h-14 w-14 text-2xl">🗝</div>
        <h1 className="mt-5 text-serif-cn text-[26px] font-bold leading-tight text-ink-800">
          助记词找回
        </h1>
        <div className="label-cormorant mt-2">RECOVER ACCOUNT</div>
        <p className="mt-3 text-[13px] leading-7 text-ink-600">
          输入你注册时抄下的 <strong className="text-ink-800">24 个单词</strong>，用空格分隔。
          <br />
          顺序必须严格一致。
        </p>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="label-cormorant">24 WORDS</div>
            <div className={`text-display text-[11px] font-bold num ${wordCount === 24 ? 'text-success-500' : 'text-ink-600'}`}>
              {wordCount} / 24
            </div>
          </div>
          <textarea
            className="h-44 w-full resize-none rounded-2xl border border-warm-100 bg-white p-4 font-mono text-[13px] leading-7 text-ink-800 shadow-warm-sm placeholder:text-ink-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="word1 word2 word3 ... word24"
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
          />
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary">
            {error}
          </div>
        )}

        <button type="button" className="btn-primary mt-5" disabled={loading} onClick={onSubmit}>
          {loading ? '校验中…' : '找回账号 →'}
        </button>

        <p className="mt-4 text-center text-[11px] text-ink-500">
          助记词只在本地处理 · 服务端不留明文
        </p>
      </div>
    </main>
  );
}
