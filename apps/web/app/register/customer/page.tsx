'use client';

/**
 * 客户注册 · 品牌引导 + 简洁 form
 * 账号名 + 密码模式(不再用 12 词助记词)
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, ArrowRight, Eye, EyeOff, Sparkles, Lock, Star } from 'lucide-react';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';

interface RegisterResp {
  user: { id: string; userType: 'customer'; userHandle: string; displayName: string | null };
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export default function CustomerRegisterPage() {
  const router = useRouter();
  const [userHandle, setUserHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(userHandle)) return '账号名 3-16 位字母 / 数字 / 下划线';
    if (password.length < 8 || password.length > 32) return '密码 8-32 位';
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return '密码须含字母 + 数字';
    if (password !== confirmPwd) return '两次密码不一致';
    if (inviteCode && inviteCode.length > 0 && inviteCode.length < 4) {
      return '邀请码 4-12 位,或留空跳过';
    }
    return null;
  }

  async function submit() {
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      const data = await apiPost<RegisterResp>('/auth/register-simple', {
        user_type: 'customer',
        user_handle: userHandle,
        password,
        ...(inviteCode ? { invite_code: inviteCode } : {}),
        locale: 'zh',
      });
      saveTokens(data.access_token, data.refresh_token);
      if (typeof window !== 'undefined') window.location.replace('/home');
      else router.replace('/home');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError) setError(`${err.payload.code} · ${err.payload.message}`);
      else setError(String((err as Error).message));
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* 顶部 · 品牌 + 返回 */}
      <div className="flex items-center justify-between px-6 pt-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl heart-logo">
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
          <div className="font-serif-cn text-lg font-semibold">LoveRush</div>
        </Link>
        <Link href="/login" className="text-[11px] text-ink-500 hover:text-primary">
          已有账号 →
        </Link>
      </div>

      {/* 引导 · 品牌 hero */}
      <div className="px-6 pt-6">
        <div className="label-cormorant mb-1.5">CUSTOMER · 客户入驻</div>
        <h1 className="font-serif-cn text-[28px] font-semibold leading-tight text-ink-900">
          今晚 · <span className="text-primary">谁来温柔你</span>?
        </h1>
        <p className="mt-2 text-[12.5px] text-ink-500 leading-relaxed">
          账号 + 密码 30 秒注册 · 不再要 12 词助记词
          <br />
          AI 助理懂你 · 隐身够稳 · 老客户精准命中
        </p>
      </div>

      {/* 价值 chips */}
      <div className="mt-5 grid grid-cols-1 gap-2 px-6">
        {[
          { icon: <Sparkles className="h-3.5 w-3.5 text-primary" />, label: 'AI 助理 1→3 精选', sub: '不让你刷 100 个技师' },
          { icon: <Lock className="h-3.5 w-3.5 text-emerald-600" />, label: '隐身 · 计算器伪装', sub: '一键擦除 · 配偶发现兜底' },
          { icon: <Star className="h-3.5 w-3.5 text-warm-500" />, label: '第 2 次起精准命中', sub: '越用越懂你的口味' },
        ].map((v) => (
          <div key={v.label} className="flex items-start gap-2.5 rounded-2xl border border-warm-100 bg-white px-3.5 py-2.5 shadow-warm-xs">
            <div className="mt-0.5">{v.icon}</div>
            <div className="flex-1">
              <div className="text-[12.5px] font-medium text-ink-800">{v.label}</div>
              <div className="text-[10.5px] text-ink-500">{v.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 表单 */}
      <div className="mt-6 space-y-3.5 px-6 pb-12">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-ink-700">
            账号名 <span className="text-ink-400">(3-16 位字母 / 数字)</span>
          </label>
          <input
            type="text"
            value={userHandle}
            onChange={(e) => setUserHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            placeholder="例:lily2026"
            autoComplete="username"
            autoCapitalize="none"
            className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-ink-700">
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
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-ink-700">确认密码</label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="再输一次"
            autoComplete="new-password"
            className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-ink-700">
            邀请码 <span className="text-ink-400">(可选 · 留空跳过)</span>
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
          {busy ? '创建中…' : '进入 LoveRush'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>

        <div className="text-center text-[11px] text-ink-400">
          是技师入驻?
          <Link href="/register/therapist" className="ml-1 text-primary hover:underline">
            去技师注册 →
          </Link>
        </div>
      </div>
    </div>
  );
}
