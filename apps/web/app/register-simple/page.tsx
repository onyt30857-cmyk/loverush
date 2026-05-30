'use client';

/**
 * 简化注册 · 账号名 + 密码
 *
 * 不再用 BIP-39 12 词助记词 → 用户体验大幅简化
 * 流程:身份 → 账号名 → 密码 → 邀请码(可选)→ 进首页
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';

interface RegisterSimpleResponse {
  user: { id: string; userType: 'customer' | 'therapist'; userHandle: string; displayName: string | null };
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export default function RegisterSimplePage() {
  const router = useRouter();
  const [userType, setUserType] = useState<'customer' | 'therapist' | null>(null);
  const [userHandle, setUserHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!userType) return '请选择身份';
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(userHandle)) {
      return '账号名 3-16 位字母 / 数字 / 下划线';
    }
    if (password.length < 8 || password.length > 32) {
      return '密码 8-32 位';
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return '密码须含字母 + 数字';
    }
    if (password !== confirmPwd) return '两次密码不一致';
    if (inviteCode && inviteCode.length > 0 && inviteCode.length < 4) {
      return '邀请码 4-12 位,或留空跳过';
    }
    return null;
  }

  async function submit() {
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      const data = await apiPost<RegisterSimpleResponse>('/auth/register-simple', {
        user_type: userType,
        user_handle: userHandle,
        password,
        ...(inviteCode ? { invite_code: inviteCode } : {}),
        locale: 'zh',
      });
      saveTokens(data.access_token, data.refresh_token);
      // 直接进首页(无需 PIN / 助记词步骤)
      const target = userType === 'therapist' ? '/t/home' : '/home';
      if (typeof window !== 'undefined') {
        window.location.replace(target);
      } else {
        router.replace(target);
      }
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError) {
        setError(`${err.payload.code} · ${err.payload.message}`);
      } else {
        setError(String((err as Error).message));
      }
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* 头部 */}
      <div className="px-6 pt-10">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl heart-logo">
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
          <div className="font-serif-cn text-lg font-semibold">LoveRush</div>
        </div>
        <h1 className="mt-6 font-serif-cn text-[24px] font-semibold leading-tight">
          创建账号 · 30 秒
        </h1>
        <p className="mt-1.5 text-[12px] text-ink-500">
          账号名 + 密码 · 简单安全 · 没有助记词
        </p>
      </div>

      <div className="mt-6 space-y-4 px-6 pb-12">
        {/* 身份选择 */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">我的身份</label>
          <div className="grid grid-cols-2 gap-2">
            {(['customer', 'therapist'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setUserType(t)}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  userType === t
                    ? 'border-primary bg-gradient-cta text-white shadow-warm-md'
                    : 'border-warm-100 bg-white text-ink-700 hover:border-primary/40'
                }`}
              >
                {t === 'customer' ? '👤 客户' : '💆 技师'}
              </button>
            ))}
          </div>
        </div>

        {/* 账号名 */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">
            账号名 <span className="text-ink-400">(3-16 位字母/数字)</span>
          </label>
          <input
            type="text"
            value={userHandle}
            onChange={(e) => setUserHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            placeholder="例如:lily2026"
            autoComplete="username"
            autoCapitalize="none"
            className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* 密码 */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">
            密码 <span className="text-ink-400">(8-32 位 · 字母+数字)</span>
          </label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              autoComplete="new-password"
              className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 pr-10 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
              aria-label={showPwd ? '隐藏密码' : '显示密码'}
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* 确认密码 */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">确认密码</label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="再输一次"
            autoComplete="new-password"
            className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* 邀请码(可选) */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-ink-700">
            邀请码 <span className="text-ink-400">(可选 · 4-12 位)</span>
          </label>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="LOVE2026"
            autoCapitalize="characters"
            className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm uppercase outline-none focus:border-primary"
          />
        </div>

        {/* 错误 */}
        {error && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-[12px] text-primary">
            {error}
          </div>
        )}

        {/* 提交 */}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-2 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta text-[16px] font-semibold text-white shadow-rose-lg active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? '创建中…' : '创建账号 · 立即进入'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>

        {/* 已有账号 → 登录 */}
        <div className="text-center text-[12px] text-ink-500">
          已有账号?
          <Link href="/login" className="ml-1 font-medium text-primary hover:underline">
            去登录 →
          </Link>
        </div>
      </div>
    </div>
  );
}
