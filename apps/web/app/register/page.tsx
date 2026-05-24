'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';
import { deriveStaticKeyPair, storeKeyPair } from '@/lib/crypto';

interface RegisterResponse {
  user: { id: string; userType: 'customer' | 'therapist'; displayName: string | null };
  mnemonic: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [userType, setUserType] = useState<'customer' | 'therapist'>('customer');
  const [inviteCode, setInviteCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (inviteCode.trim().length < 4) {
      setError('邀请码至少 4 位');
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<RegisterResponse>('/auth/register', {
        user_type: userType,
        invite_code: inviteCode.trim(),
        display_name: displayName.trim() || undefined,
      });
      saveTokens(data.access_token, data.refresh_token);

      // D-204 · 派生 X25519 静态密钥对 + 本地存储 + 上传公钥
      try {
        const kp = await deriveStaticKeyPair(data.mnemonic);
        await storeKeyPair(kp);
        await apiPost('/me/encryption-key', {
          algorithm: 'x25519',
          public_key: kp.publicKeyB64,
        });
      } catch (e) {
        console.warn('[crypto] key derivation failed:', e);
      }

      sessionStorage.setItem('pending_mnemonic', data.mnemonic);
      router.push('/register/backup');
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
      {/* 顶栏 */}
      <header className="flex h-14 items-center px-4">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95"
        >
          ←
        </Link>
      </header>

      <div className="px-6 pb-10">
        <div className="animate-fade-up">
          <h1 className="text-serif-cn text-[28px] font-bold leading-tight text-ink-800">
            创建匿名账号
          </h1>
          <div className="label-cormorant mt-2">CREATE YOUR ACCOUNT</div>
          <p className="mt-3 text-[13px] leading-7 text-ink-600">
            注册后会生成 <strong className="text-ink-800">24 词助记词</strong>，
            <br />
            妥善保管即可在任何设备登入。
          </p>
        </div>

        <div className="mt-8 space-y-5 animate-fade-up" style={{ animationDelay: '80ms' }}>
          {/* 角色选择 */}
          <div>
            <div className="label-cormorant mb-2">I AM A...</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setUserType('customer')}
                className={`flex flex-col items-center rounded-2xl border-2 py-4 transition active:scale-[0.98] ${
                  userType === 'customer'
                    ? 'border-primary bg-primary/5 shadow-rose-md'
                    : 'border-warm-100 bg-white shadow-warm-xs'
                }`}
              >
                <div className="text-2xl">🌸</div>
                <div className="mt-1 text-serif-cn text-base font-semibold text-ink-800">客户</div>
                <div className="label-cormorant mt-0.5">CUSTOMER</div>
              </button>
              <button
                type="button"
                onClick={() => setUserType('therapist')}
                className={`flex flex-col items-center rounded-2xl border-2 py-4 transition active:scale-[0.98] ${
                  userType === 'therapist'
                    ? 'border-primary bg-primary/5 shadow-rose-md'
                    : 'border-warm-100 bg-white shadow-warm-xs'
                }`}
              >
                <div className="text-2xl">💝</div>
                <div className="mt-1 text-serif-cn text-base font-semibold text-ink-800">技师</div>
                <div className="label-cormorant mt-0.5">THERAPIST</div>
              </button>
            </div>
          </div>

          {/* 邀请码 */}
          <div>
            <div className="label-cormorant mb-2">INVITE CODE</div>
            <input
              className="input-field"
              placeholder="请输入邀请码"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoCapitalize="characters"
            />
          </div>

          {/* 昵称 */}
          <div>
            <div className="label-cormorant mb-2">NICKNAME · 可选</div>
            <input
              className="input-field"
              placeholder="给自己起个昵称"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary">
              {error}
            </div>
          )}

          <button type="button" className="btn-primary mt-6" disabled={loading} onClick={onSubmit}>
            {loading ? '注册中…' : '立即注册'}
          </button>

          <p className="text-center text-[10px] text-ink-500">
            注册即代表你同意《用户协议》与《隐私政策》
          </p>
        </div>
      </div>
    </main>
  );
}
