'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setupLock, markUnlocked, type LockUserMeta } from '@/lib/lock';
import { getAccessToken } from '@/lib/api';

export default function MnemonicBackupPage() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('pending_mnemonic');
    if (!raw) {
      router.replace('/register');
      return;
    }
    setMnemonic(raw.trim().split(/\s+/));
  }, [router]);

  function onCopy() {
    void navigator.clipboard.writeText(mnemonic.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function onDone() {
    setPinError(null);
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setPinError('PIN 须 6 位数字');
      return;
    }
    if (pin !== pinConfirm) {
      setPinError('两次 PIN 输入不一致');
      return;
    }
    setBusy(true);

    // 防御性:逐步骤 try/catch + 错误明确化(原 catch 一锅烩,失败用户只看到"PIN 设置失败")
    const refreshToken =
      typeof window !== 'undefined' ? window.localStorage.getItem('refresh_token') : null;
    const userType = (sessionStorage.getItem('pending_user_type') as
      | 'customer'
      | 'therapist'
      | null) ?? 'customer';
    const userId = sessionStorage.getItem('pending_user_id');
    const displayName = sessionStorage.getItem('pending_display_name') || null;
    const target = userType === 'therapist' ? '/t/home' : '/home';

    if (refreshToken && userId && getAccessToken()) {
      try {
        const meta: LockUserMeta = { id: userId, displayName, userType };
        await setupLock({ pin, mnemonic: mnemonic.join(' '), refreshToken, meta });
        markUnlocked();
      } catch (e) {
        console.error('[backup] setupLock failed:', e);
        setPinError(`加密失败: ${e instanceof Error ? e.message : '未知错误'}`);
        setBusy(false);
        return;
      }
    }

    sessionStorage.removeItem('pending_mnemonic');
    sessionStorage.removeItem('pending_user_type');
    sessionStorage.removeItem('pending_user_id');
    sessionStorage.removeItem('pending_display_name');

    // 路由:先用 Next router · 兜底 250ms 后还在原页就用 window.location 强切
    try {
      router.replace(target);
    } catch (e) {
      console.warn('[backup] router.replace threw:', e);
    }
    setTimeout(() => {
      if (typeof window !== 'undefined' && window.location.pathname === '/register/backup') {
        console.warn('[backup] router did not navigate, forcing window.location');
        window.location.replace(target);
      }
    }, 250);
  }

  return (
    // 用 .mobile-container 让超长内容内部滚动(勾选后 PIN 区展开会顶破 viewport,
    // 原 min-h-screen + body flex-center 会把整个 main 顶出视口,所以改用统一壳)
    <div className="mobile-container bg-gradient-soft px-6 pb-10">
      <div className="pt-8 animate-fade-up">
        <div className="gradient-orb h-14 w-14 text-2xl">🔐</div>
        <h1 className="mt-5 text-serif-cn text-[26px] font-bold leading-tight text-ink-800">
          请抄下这 {mnemonic.length || 12} 个词
        </h1>
        <div className="label-cormorant mt-2">YOUR RECOVERY PHRASE</div>
        <div className="mt-4 rounded-2xl border border-warm-200 bg-warm-50 p-4">
          <div className="flex gap-2">
            <span className="text-lg">⚠️</span>
            <p className="flex-1 text-[12px] leading-7 text-warm-700">
              这是你账号 <strong>唯一</strong> 的凭证，丢失即<strong>无法找回</strong>。
              <br />
              请抄到纸上 · <strong>不要截图</strong> · 不要拍照。
            </p>
          </div>
        </div>
      </div>

      {/* 助记词网格 */}
      <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-md animate-fade-up" style={{ animationDelay: '100ms' }}>
        {mnemonic.map((word, i) => (
          <div
            key={i}
            className="flex items-center gap-1 rounded-xl bg-warm-50 px-2.5 py-2"
            style={{ animationDelay: `${i * 15}ms` }}
          >
            <span className="text-display w-5 text-right text-[10px] font-bold text-warm-500 num">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="font-mono text-[12px] font-medium text-ink-800">{word}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn-ghost mt-3"
        onClick={onCopy}
      >
        {copied ? '✓ 已复制' : '📋 复制助记词'}
      </button>

      <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-primary"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="text-[13px] leading-6 text-ink-800">
          我已抄写并<strong>妥善保管</strong>，明白丢失即<strong>无法找回</strong>账号
        </span>
      </label>

      {/* Phase C · 设置本机 PIN 锁:勾选后才显,免初始视觉嘈杂 */}
      {confirmed && (
        <section className="mt-6 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-md animate-fade-up">
          <div className="text-serif-cn text-[15px] font-semibold text-ink-800">设置解锁 PIN</div>
          <div className="mt-1 text-[11.5px] leading-6 text-ink-500">
            6 位数字 · 本机加密保存助记词 + 登录态
            <br />
            日常打开 App 输 PIN 即可,无需重抄助记词
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              inputMode="numeric"
              pattern="\d*"
              autoComplete="new-password"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setPinError(null);
              }}
              placeholder="6 位 PIN"
              className="flex-1 rounded-xl border border-warm-100 bg-white px-3 py-2.5 text-center font-mono text-[16px] tracking-[0.3em] text-ink-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="\d*"
              autoComplete="new-password"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
              value={pinConfirm}
              onChange={(e) => {
                setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 6));
                setPinError(null);
              }}
              placeholder="再输一次"
              className="flex-1 rounded-xl border border-warm-100 bg-white px-3 py-2.5 text-center font-mono text-[16px] tracking-[0.3em] text-ink-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
          {pinError && <div className="mt-2 text-[11.5px] text-primary">{pinError}</div>}
        </section>
      )}

      <button
        type="button"
        className="btn-primary mt-6"
        disabled={
          !confirmed || mnemonic.length === 0 || pin.length !== 6 || pinConfirm.length !== 6 || busy
        }
        onClick={() => void onDone()}
      >
        {busy ? '加密中…' : '设置 PIN 并进入首页 →'}
      </button>
    </div>
  );
}
