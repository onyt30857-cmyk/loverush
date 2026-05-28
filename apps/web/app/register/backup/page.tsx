'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MnemonicBackupPage() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

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

  function onDone() {
    const userType = sessionStorage.getItem('pending_user_type');
    sessionStorage.removeItem('pending_mnemonic');
    sessionStorage.removeItem('pending_user_type');
    // C3 修复 · §6：客户注册完成 → /home（不是 /discover），技师 → /t/home
    router.replace(userType === 'therapist' ? '/t/home' : '/home');
  }

  return (
    <main className="min-h-screen bg-gradient-soft px-6 pb-10">
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

      <button
        type="button"
        className="btn-primary mt-6"
        disabled={!confirmed || mnemonic.length === 0}
        onClick={onDone}
      >
        我已备份，进入首页 →
      </button>
    </main>
  );
}
