'use client';

/**
 * PinGate · 启动解锁屏
 *
 * 仅在本机已设置 PIN(lock.hasLock() === true)时显示。
 * 由 AuthProvider 在启动时决定是否渲染。
 *
 * 流程:
 *   6 位 PIN 自动提交 → lock.unlock() → 成功回 onUnlock({mnemonic, refreshToken})
 *   错误 / 锁定 / 强制恢复:UI 自适应,引导用户走 /recover
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  unlock,
  getLockoutMsRemaining,
  getUserMeta,
  isForcedRecover,
  type LockUserMeta,
} from '@/lib/lock';

interface Props {
  /**
   * 解锁成功后回调,父组件用 mnemonic + refreshToken 重新建立 session。
   * 把当前 PIN 也回传,父组件可在 /auth/refresh 拿到新 refresh_token 后用同一 PIN 重新加密 blob。
   */
  onUnlock: (args: { mnemonic: string; refreshToken: string; pin: string }) => void | Promise<void>;
}

const PIN_LEN = 6;

export function PinGate({ onUnlock }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockoutMs, setLockoutMs] = useState(0);
  const [meta, setMeta] = useState<LockUserMeta | null>(null);
  const [forced, setForced] = useState(false);

  // 启动一次性读取本机状态
  useEffect(() => {
    setMeta(getUserMeta());
    setForced(isForcedRecover());
    setLockoutMs(getLockoutMsRemaining());
  }, []);

  // 锁定倒计时 tick
  useEffect(() => {
    if (lockoutMs <= 0) return;
    const id = setInterval(() => {
      const rem = getLockoutMsRemaining();
      setLockoutMs(rem);
      if (rem <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [lockoutMs]);

  const locked = lockoutMs > 0;

  async function tryUnlock(p: string) {
    if (busy || locked || forced) return;
    setBusy(true);
    setError(null);
    const r = await unlock(p);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setPin('');
      if (r.forced) setForced(true);
      setLockoutMs(getLockoutMsRemaining());
      return;
    }
    void onUnlock({ mnemonic: r.mnemonic, refreshToken: r.refreshToken, pin: p });
  }

  function press(digit: string) {
    if (locked || forced || busy) return;
    if (pin.length >= PIN_LEN) return;
    const next = pin + digit;
    setPin(next);
    setError(null);
    if (next.length === PIN_LEN) {
      void tryUnlock(next);
    }
  }

  function backspace() {
    if (locked || forced || busy) return;
    setPin((cur) => cur.slice(0, -1));
    setError(null);
  }

  // ── 强制走助记词恢复 ──
  if (forced) {
    return (
      <div className="mobile-container flex flex-col items-center justify-center bg-gradient-soft px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm text-3xl">
          🔐
        </div>
        <h1 className="mt-5 text-serif-cn text-[18px] font-bold text-ink-800">
          尝试次数过多
        </h1>
        <p className="mt-2 max-w-[260px] text-[12.5px] leading-7 text-ink-500">
          为账户安全,本机已锁定。
          <br />
          请通过助记词重新恢复账号。
        </p>
        <button
          type="button"
          onClick={() => router.push('/recover')}
          className="mt-6 rounded-full bg-gradient-cta px-8 py-2.5 text-[14px] font-medium text-white shadow-rose-md active:scale-95"
        >
          助记词恢复 →
        </button>
      </div>
    );
  }

  // ── 正常 PIN 锁屏 ──
  return (
    <div className="mobile-container flex flex-col bg-gradient-soft px-6">
      {/* 顶部欢迎区 */}
      <div className="pt-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-cta shadow-rose-lg text-2xl">
          🔓
        </div>
        <h1 className="mt-4 text-serif-cn text-[20px] font-bold text-ink-800">
          {meta?.displayName ? `${meta.displayName},欢迎回来` : '欢迎回来'}
        </h1>
        <div className="mt-1.5 text-[12.5px] text-ink-500">输入 6 位 PIN 解锁本机</div>
      </div>

      {/* 6 位点位 */}
      <div className="mt-8 flex justify-center gap-3">
        {Array.from({ length: PIN_LEN }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full transition ${
              i < pin.length ? 'scale-110 bg-primary' : 'bg-warm-100'
            }`}
          />
        ))}
      </div>

      {/* 错误 / 锁定提示 */}
      <div className="mt-4 min-h-[18px] text-center text-[12.5px] text-primary">
        {error
          ? `${error}${locked && lockoutMs > 0 ? ` · ${Math.ceil(lockoutMs / 1000)}s` : ''}`
          : locked
            ? `请等待 ${Math.ceil(lockoutMs / 1000)} 秒`
            : ''}
      </div>

      {/* 数字键盘 */}
      <div className="mx-auto mt-4 grid w-full max-w-[300px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            disabled={locked || busy}
            className="h-14 rounded-2xl bg-white text-[22px] font-medium text-ink-800 shadow-warm-sm transition active:scale-95 active:bg-warm-50 disabled:opacity-40"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => router.push('/recover')}
          className="h-14 text-[11px] text-ink-500 hover:text-primary"
        >
          忘记 PIN?
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          disabled={locked || busy}
          className="h-14 rounded-2xl bg-white text-[22px] font-medium text-ink-800 shadow-warm-sm transition active:scale-95 active:bg-warm-50 disabled:opacity-40"
        >
          0
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={locked || busy}
          className="h-14 text-[18px] text-ink-500 hover:text-ink-700"
        >
          ⌫
        </button>
      </div>

      <div className="mt-auto pb-8 text-center text-cormorant text-[10px] tracking-[0.16em] text-ink-300">
        本机解密 · 服务端不留 PIN
      </div>
    </div>
  );
}
