'use client';

import { useEffect, useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PrimaryButton } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface Earnings {
  available_cents: string;
  pending_cents: string;
  withdrawn_cents: string;
  tip_earnings_cents: string;
  shop_commission_cents: string;
  invite_rewards_cents: string;
}

interface Withdrawal {
  id: string;
  amountCents: number;
  method: string;
  status: string;
  requestedAt: string;
}

export default function EarningsPage() {
  const [data, setData] = useState<{ earnings: Earnings | null } | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [mode, setMode] = useState<'detail' | 'apply'>('detail');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'wise' | 'bank' | 'paynow' | 'usdt'>('wise');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [d, wlist] = await Promise.all([
      apiGet<{ earnings: Earnings | null }>('/dashboard/therapist/me').catch(() => ({ earnings: null })),
      apiGet<Withdrawal[]>('/me/withdrawals').catch(() => []),
    ]);
    setData(d);
    setWithdrawals(wlist);
  }

  useEffect(() => {
    void load();
  }, []);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const cents = Math.floor(Number(amount) * 100);
      await apiPost('/me/withdrawals', {
        amount_cents: cents,
        method,
        payout_details_encrypted: details, // 实际应客户端加密；这里直接传明文，后端 schema 字段名为 encrypted
      });
      setMode('detail');
      setAmount('');
      setDetails('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <TherapistShell title="收益" showBack hideTabBar><LoadingFull /></TherapistShell>;

  const e = data.earnings;
  const available = e ? parseInt(e.available_cents) : 0;

  return (
    <TherapistShell title="收益与提现" showBack hideTabBar>
      <div className="bg-gradient-soft px-5 py-5">
        {/* 大金额卡 */}
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">AVAILABLE TO WITHDRAW</div>
          <div className="mt-1 flex items-end gap-1.5">
            <span className="text-display text-4xl font-bold num">${(available / 100).toFixed(2)}</span>
            <span className="pb-1 text-xs text-white/70">USD</span>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[11px] text-white/85">
            <span>
              处理中{' '}
              <span className="text-display font-bold text-white num">
                ${e ? (parseInt(e.pending_cents) / 100).toFixed(2) : '0.00'}
              </span>
            </span>
            <span>
              已提现{' '}
              <span className="text-display font-bold text-white num">
                ${e ? (parseInt(e.withdrawn_cents) / 100).toFixed(2) : '0.00'}
              </span>
            </span>
          </div>
        </div>

        {/* 收入来源 */}
        <div className="mt-4 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
          <div className="text-serif-cn text-sm font-semibold text-ink-800">收入来源</div>
          <div className="label-cormorant mb-3">REVENUE SOURCES</div>
          <div className="space-y-2.5 text-sm">
            <Row label="小费" emoji="💝" value={e ? `$${(parseInt(e.tip_earnings_cents) / 100).toFixed(2)}` : '—'} />
            <Row label="橱窗分成" emoji="🛍" value={e ? `$${(parseInt(e.shop_commission_cents) / 100).toFixed(2)}` : '—'} />
            <Row label="R 码邀请" emoji="✨" value={e ? `$${(parseInt(e.invite_rewards_cents) / 100).toFixed(2)}` : '—'} />
          </div>
        </div>

        <ErrorBanner message={error} />

        {mode === 'detail' ? (
          <PrimaryButton
            className="mt-5"
            disabled={available < 5000}
            onClick={() => setMode('apply')}
          >
            申请提现（最低 $50）
          </PrimaryButton>
        ) : (
          <div className="mt-5 space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
            <div className="text-sm font-semibold">提现申请</div>
            <input
              className="input-field"
              type="number"
              placeholder="金额 (USD)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="grid grid-cols-4 gap-2">
              {(['wise', 'bank', 'paynow', 'usdt'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-xl border py-2 text-xs uppercase ${
                    method === m ? 'border-primary bg-primary/5 text-primary' : 'border-ink-100'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <input
              className="input-field"
              placeholder="收款账号 / 钱包地址 / 邮箱"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('detail')}
                className="rounded-xl border border-ink-100 py-2 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy || !amount || !details}
                className="rounded-xl bg-primary py-2 text-sm text-white disabled:opacity-50"
              >
                {busy ? '提交中…' : '提交申请'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 text-sm font-semibold">提现记录</div>
          {!withdrawals || withdrawals.length === 0 ? (
            // M2.T · §8 四件套：icon + 主文 + 辅助文 + 次级动作
            <div className="mt-2 flex flex-col items-center rounded-2xl bg-white px-6 py-8 text-center shadow-warm-xs">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50">
                <span className="text-3xl">💸</span>
              </div>
              <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">
                还没有提现记录
              </div>
              <div className="mt-1.5 text-[12px] leading-5 text-ink-500">
                提现申请提交后会显示在这里，处理状态实时更新
              </div>
              <a
                href="https://help.loverush.app/therapist/withdrawal"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 rounded-full bg-warm-50 px-4 py-1.5 text-[12px] text-ink-700 active:scale-95"
              >
                了解提现规则 →
              </a>
            </div>
          ) : (
            <ul className="space-y-2">
              {withdrawals.map((w) => (
                <li key={w.id} className="flex items-center justify-between rounded-xl border border-ink-100 bg-white p-3 text-sm">
                  <div>
                    <div>${(w.amountCents / 100).toFixed(2)}</div>
                    <div className="text-xs text-ink-500">
                      {w.method.toUpperCase()} · {new Date(w.requestedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="rounded-full bg-ink-50 px-2 py-0.5 text-xs">{w.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </TherapistShell>
  );
}

function Row({ label, value, emoji }: { label: string; value: string; emoji?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-ink-600">
        {emoji && <span>{emoji}</span>}
        {label}
      </span>
      <span className="text-display font-bold text-ink-800 num">{value}</span>
    </div>
  );
}
