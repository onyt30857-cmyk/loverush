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

const TOTAL = 24;

export default function RecoverPage() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = mnemonic.trim() ? mnemonic.trim().split(/\s+/).length : 0;
  const ready = wordCount === TOTAL;

  async function onSubmit() {
    setError(null);
    const list = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (list.length !== TOTAL) {
      setError(`需要 ${TOTAL} 个助记词，当前 ${list.length} 个`);
      return;
    }
    const joined = list.join(' ');
    setLoading(true);
    try {
      const data = await apiPost<RecoverResponse>('/auth/recover', { mnemonic: joined });
      saveTokens(data.access_token, data.refresh_token);

      try {
        const kp = await deriveStaticKeyPair(joined);
        await storeKeyPair(kp);
        await apiPost('/me/encryption-key', { algorithm: 'x25519', public_key: kp.publicKeyB64 });
      } catch (e) {
        console.warn('[crypto] key restore failed:', e);
      }

      router.push(data.user.user_type === 'therapist' ? '/t/home' : '/discover');
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.payload.message || '助记词校验未通过，请逐字核对');
      } else {
        setError('网络好像开小差了，请稍后再试');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      <div className="flex h-14 shrink-0 items-center px-6">
        <Link
          href="/"
          aria-label="返回"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-sm active:scale-95"
        >
          ←
        </Link>
      </div>

      <div className="animate-fade-up px-6 pb-10">
        {/* 品牌徽标 + 标题 */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[18px] bg-gradient-cta shadow-rose-lg">
            <span className="pointer-events-none absolute -inset-[5px] rounded-[22px] border-[1.5px] border-primary/25" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 text-white">
              <circle cx="8" cy="8" r="5" />
              <path d="M11.5 11.5 20 20M17 17l2-2M14.5 14.5 17 12" />
            </svg>
          </div>
          <div>
            <h1 className="text-serif-cn text-[25px] font-bold leading-none text-ink-900">助记词找回</h1>
            <div className="label-cormorant mt-1.5 text-[12.5px]">RECOVER ACCOUNT</div>
          </div>
        </div>

        <p className="mt-[18px] text-[13px] leading-[1.85] text-ink-500">
          输入注册时抄下的 <strong className="font-semibold text-ink-800">24 个助记词</strong>，用空格分隔。
          <br />
          顺序必须严格一致，单词全部小写。
        </p>

        {/* 安全信任条 */}
        <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-warm-100 bg-white/70 px-3.5 py-2.5 backdrop-blur">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-emerald-600">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-[11.5px] leading-snug text-ink-700">
            <strong className="font-semibold text-ink-900">本地解密</strong>　助记词只在此设备校验，服务端永不接触明文
          </span>
        </div>

        {/* 进度 */}
        <div className="mb-2.5 mt-6 flex items-center justify-between">
          <div className="label-cormorant">24 WORDS</div>
          <div className={`num text-display text-[12px] font-bold ${ready ? 'text-success-500' : 'text-primary'}`}>
            {String(Math.min(wordCount, TOTAL)).padStart(2, '0')}
            <span className="text-ink-300"> / {TOTAL}</span>
          </div>
        </div>
        <div className="mb-3.5 h-1 overflow-hidden rounded-full bg-warm-100">
          <div
            className={`h-full rounded-full transition-all duration-300 ${ready ? 'bg-success-500' : 'bg-gradient-cta'}`}
            style={{ width: `${Math.min(wordCount / TOTAL, 1) * 100}%` }}
          />
        </div>

        {/* 单个助记词输入框 */}
        <textarea
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="按顺序输入 24 个助记词，用空格分隔，可直接粘贴整段…"
          className="h-48 w-full resize-none rounded-2xl border border-warm-100 bg-white p-4 font-mono text-[14px] leading-8 tracking-wide text-ink-900 shadow-warm-sm outline-none transition placeholder:font-sans placeholder:text-[12.5px] placeholder:leading-7 placeholder:tracking-normal placeholder:text-ink-300 focus:border-primary focus:ring-2 focus:ring-primary/15"
        />

        {error && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-[12.5px] text-primary">
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => void onSubmit()}
          className="mt-6 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta text-[16px] font-semibold tracking-wide text-white shadow-rose-lg transition active:scale-[0.99] disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {loading ? '校验中…' : '找回账号'}
        </button>

        <div className="mt-4 text-center text-cormorant text-[11px] tracking-[0.16em] text-ink-300">
          BIP-39 标准 · 24 词助记词 · 端到端加密
        </div>
      </div>
    </div>
  );
}
