'use client';

/**
 * 技师入驻 · 品牌引导 + 简洁 form
 * 账号名 + 密码模式(不再用 12 词助记词)
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, ArrowRight, Eye, EyeOff, Wallet, Shield, Sparkles } from 'lucide-react';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';

interface RegisterResp {
  user: { id: string; userType: 'therapist'; userHandle: string; displayName: string | null };
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export default function TherapistRegisterPage() {
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
        user_type: 'therapist',
        user_handle: userHandle,
        password,
        ...(inviteCode ? { invite_code: inviteCode } : {}),
        locale: 'zh',
      });
      saveTokens(data.access_token, data.refresh_token);
      // 技师进入工作台
      if (typeof window !== 'undefined') window.location.replace('/t/home');
      else router.replace('/t/home');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError) setError(`${err.payload.code} · ${err.payload.message}`);
      else setError(String((err as Error).message));
    }
  }

  return (
    <div className="mobile-container" style={{ background: 'linear-gradient(180deg, #FFF1F8 0%, #FAFAFA 60%)' }}>
      {/* 顶部 · 品牌 + 返回 */}
      <div className="flex items-center justify-between px-6 pt-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #FF6BAA, #B8398C)' }}>
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
          <div className="font-serif-cn text-lg font-semibold">LoveRush</div>
        </Link>
        <Link href="/login" className="text-[11px] text-ink-500 hover:text-[#B8398C]">
          已有账号 →
        </Link>
      </div>

      {/* 引导 · 品牌 hero · 技师玫红主题 */}
      <div className="px-6 pt-6">
        <div className="label-cormorant mb-1.5" style={{ color: '#B8398C' }}>THERAPIST · 入驻</div>
        <h1 className="font-serif-cn text-[28px] font-semibold leading-tight text-ink-900">
          撮合不抽佣 ·
          <br />
          <span style={{ color: '#B8398C' }}>赚多少 全是你的</span>
        </h1>
        <p className="mt-2 text-[12.5px] text-ink-500 leading-relaxed">
          账号 + 密码 30 秒注册 · 不再要 12 词助记词
          <br />
          AI 红线替你守门 · 离线 AI 分身替你接洽
        </p>
      </div>

      {/* 价值 chips · 技师版 */}
      <div className="mt-5 grid grid-cols-1 gap-2 px-6">
        {[
          { icon: <Wallet className="h-3.5 w-3.5" style={{ color: '#B8398C' }} />, label: '服务收入 100% 归你', sub: '平台不抽 · 客户消费的积分 = 你的收入' },
          { icon: <Shield className="h-3.5 w-3.5 text-emerald-600" />, label: 'AI 红线守卫', sub: '骚扰 / 脱平台 / 涉黄涉政 自动过滤' },
          { icon: <Sparkles className="h-3.5 w-3.5 text-amber-500" />, label: 'AI 分身 24h 替你聊', sub: '离线时也能接洽客户 · 不漏订单' },
        ].map((v) => (
          <div key={v.label} className="flex items-start gap-2.5 rounded-2xl border border-pink-100 bg-white px-3.5 py-2.5 shadow-sm">
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
            placeholder="例:mei2026"
            autoComplete="username"
            autoCapitalize="none"
            className="w-full rounded-xl border border-pink-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#B8398C]"
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
              className="w-full rounded-xl border border-pink-100 bg-white px-4 py-3 pr-10 text-sm outline-none focus:border-[#B8398C]"
            />
            <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400">
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
            className="w-full rounded-xl border border-pink-100 bg-white px-4 py-3 text-sm outline-none focus:border-[#B8398C]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-ink-700">
            邀请码 <span className="text-ink-400">(可选 · 从平台/上级技师拿)</span>
          </label>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="TH2026"
            autoCapitalize="characters"
            className="w-full rounded-xl border border-pink-100 bg-white px-4 py-3 text-sm uppercase outline-none focus:border-[#B8398C]"
          />
        </div>

        {error && (
          <div className="rounded-xl border px-4 py-3 text-[12px]" style={{ borderColor: 'rgba(184,57,140,0.3)', background: 'rgba(184,57,140,0.05)', color: '#B8398C' }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="mt-2 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold text-white shadow active:scale-[0.99] disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #FF6BAA, #B8398C)', boxShadow: '0 8px 24px rgba(184,57,140,0.3)' }}
        >
          {busy ? '入驻中…' : '进入工作台'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>

        <div className="text-center text-[11px] text-ink-400">
          是客户?
          <Link href="/register/customer" className="ml-1 hover:underline" style={{ color: '#B8398C' }}>
            去客户注册 →
          </Link>
        </div>
      </div>
    </div>
  );
}
