'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface Code {
  id: string;
  code: string;
  kind: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
}

interface RStatus {
  level: number;
  commissionBps: number;
  invitedTherapistCount: number;
  activeTherapistCount: number;
  totalCommissionEarnedCents: string;
}

const KINDS: Record<'U' | 'T' | 'R', { label: string; emoji: string; desc: string }> = {
  U: { label: '邀好友', emoji: '🌸', desc: '客户拉客户' },
  T: { label: '邀客户', emoji: '💌', desc: '我的客户码' },
  R: { label: '邀技师', emoji: '✨', desc: '推荐有现金分成' },
};

export default function InvitesPage() {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [rStatus, setRStatus] = useState<RStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function load() {
    const [c, r] = await Promise.all([
      apiGet<Code[]>('/invites/codes').catch(() => []),
      apiGet<RStatus | null>('/invites/r-code').catch(() => null),
    ]);
    setCodes(c);
    setRStatus(r);
  }

  useEffect(() => {
    void load();
  }, []);

  async function gen(kind: 'U' | 'T' | 'R') {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/invites/codes', { kind, max_uses: 50, expires_in_days: 90 });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  if (!codes) return <AppShell title="邀请好友" showBack hideTabBar><LoadingFull /></AppShell>;

  return (
    <AppShell title="邀请好友" showBack hideTabBar>
      {/*
        H4 修复:整页统一 bg-gradient-soft 暖渐变 + min-h-full,
        消除「上半暖 / 下半纯白」硬切割。空态卡片化(虚线 + 暖底),
        即使没有 codes 也不会有大块纯白。
      */}
      <div className="min-h-full bg-gradient-soft pb-6">
        <div className="space-y-4 px-5 pb-5 pt-2">
          <div className="label-cormorant">INVITE · 拉新有奖</div>

          {/* R 码状态卡 */}
          {rStatus && (
            <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg animate-fade-up">
              <div className="flex items-start justify-between">
                <div>
                  <div className="label-cormorant text-[10px] text-white/80">R-CODE LEVEL</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-display text-3xl font-bold">L{rStatus.level}</span>
                    <span className="text-display text-lg font-bold opacity-90">
                      {(rStatus.commissionBps / 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="label-cormorant text-[10px] text-white/80">EARNED</div>
                  <div className="text-display mt-1 text-lg font-bold num">
                    ${(parseInt(rStatus.totalCommissionEarnedCents) / 100).toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[11px] text-white/85">
                <span>
                  已邀请 <span className="text-display font-bold text-white num">{rStatus.invitedTherapistCount}</span>
                </span>
                <span>
                  活跃 <span className="text-display font-bold text-white num">{rStatus.activeTherapistCount}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 px-5">
          <ErrorBanner message={error} />

          {/* 生成邀请码 · 3 种类型卡片 */}
          <div>
            <div className="label-cormorant mb-2">CREATE NEW CODE</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(KINDS) as Array<keyof typeof KINDS>).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => void gen(k)}
                  disabled={busy}
                  className="flex flex-col items-center rounded-2xl border border-warm-100 bg-white py-3 shadow-warm-xs transition active:scale-95 disabled:opacity-50"
                >
                  <div className="text-xl">{KINDS[k].emoji}</div>
                  <div className="mt-1 text-serif-cn text-[12px] font-semibold text-ink-800">
                    {KINDS[k].label}
                  </div>
                  <div className="mt-0.5 text-[9.5px] text-ink-600">{KINDS[k].desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 我的邀请码 */}
          <div>
            <div className="label-cormorant mb-2">MY CODES · {codes.length} 个</div>
            {codes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-warm-200 bg-white/60 px-6 py-10 text-center backdrop-blur-sm">
                <div className="text-4xl">🌸</div>
                <div className="mt-3 text-serif-cn text-[14px] font-semibold text-ink-800">
                  还没有邀请码
                </div>
                <div className="mt-1.5 text-[12px] text-ink-500">
                  点上面按钮生成一个,把链接发给朋友
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {codes.map((c, i) => {
                  const expiring = c.expiresAt && new Date(c.expiresAt).getTime() - Date.now() < 7 * 86400 * 1000;
                  const pct = (c.usedCount / c.maxUses) * 100;
                  return (
                    <li
                      key={c.id}
                      className="rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-xs animate-fade-up"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono text-sm font-bold text-ink-800">{c.code}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-600">
                            <span className="rounded-full bg-warm-100 px-1.5 py-0 text-warm-700">{c.kind}</span>
                            <span>
                              <span className="text-display font-bold text-ink-800 num">{c.usedCount}</span>
                              /{c.maxUses} 已用
                            </span>
                            {c.expiresAt && (
                              <span className={expiring ? 'text-primary' : ''}>
                                · 过期 {new Date(c.expiresAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copy(c.code)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            copiedCode === c.code
                              ? 'bg-success-500/10 text-success-500'
                              : 'bg-warm-50 text-warm-700'
                          }`}
                        >
                          {copiedCode === c.code ? '✓ 已复制' : '复制'}
                        </button>
                      </div>
                      {/* 使用进度条 */}
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-warm-50">
                        <div
                          className="h-full bg-gradient-warm-rose transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
