'use client';

import { useEffect, useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { EmptyState, ErrorBanner, LoadingFull, PrimaryButton, GhostButton } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface Offer {
  id: string;
  orderId: string;
  customerId: string;
  matchScore: number;
  matchFactors: Record<string, number>;
  broadcastedAt: string;
  expiresAt: string;
}

function fmtCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PendingPage() {
  const [list, setList] = useState<Offer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  async function load() {
    const data = await apiGet<Offer[]>('/me/offers');
    setList(data);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    // 倒计时 1Hz 刷新
    const tick = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, []);

  async function accept(id: string) {
    setBusy(id);
    setError(null);
    try {
      await apiPost(`/me/offers/${id}/accept`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  async function decline(id: string) {
    setBusy(id);
    try {
      await apiPost(`/me/offers/${id}/decline`, { reason: '暂不接' });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  if (!list) return <TherapistShell title="派单"><LoadingFull /></TherapistShell>;

  return (
    <TherapistShell title="派单池">
      <div className="bg-gradient-soft px-5 pb-3 pt-2">
        <div className="label-cormorant">INCOMING OFFERS · {list.length} 待处理</div>
      </div>
      <ErrorBanner message={error} />
      {list.length === 0 ? (
        <EmptyState title="没有新派单" hint="保持在线，平台会自动推送" icon="📥" />
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {list.map((o, idx) => {
            const remainSec = Math.max(0, Math.floor((new Date(o.expiresAt).getTime() - Date.now()) / 1000));
            const urgent = remainSec < 60;
            const pct = Math.min(100, Math.max(0, (remainSec / 300) * 100)); // 默认 5min TTL
            return (
              <li
                key={o.id}
                className="animate-fade-up overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-md"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                {/* 头部：订单号 + 倒计时 */}
                <div className="flex items-center justify-between px-4 pt-3.5">
                  <div>
                    <div className="text-cormorant text-[10px] tracking-wider text-ink-600">ORDER</div>
                    <div className="font-mono text-[13px] font-semibold text-ink-800">#{o.orderId.slice(0, 8)}</div>
                  </div>
                  <div className={`text-right ${urgent ? 'text-danger-500' : 'text-warm-500'}`}>
                    <div className="text-cormorant text-[10px] tracking-wider">EXPIRES IN</div>
                    <div className={`text-display text-2xl font-bold num ${urgent ? 'animate-dot-pulse' : ''}`}>
                      {fmtCountdown(remainSec)}
                    </div>
                  </div>
                </div>

                {/* 倒计时进度条 */}
                <div className="mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-warm-50">
                  <div
                    className={`h-full transition-all ${urgent ? 'bg-danger-500' : 'bg-gradient-warm-rose'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* 匹配信息 */}
                <div className="px-4 pt-3">
                  <div className="flex items-center gap-3 text-[11px]">
                    <div className="flex items-center gap-1">
                      <span className="text-warm-500">✦</span>
                      <span className="text-cormorant">MATCH</span>
                      <span className="text-display font-bold text-ink-800 num">{o.matchScore}</span>
                    </div>
                    <div className="text-ink-600">客户 {o.customerId.slice(0, 8)}</div>
                  </div>
                </div>

                {/* 动作按钮 */}
                <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-3">
                  <GhostButton onClick={() => void decline(o.id)}>
                    {busy === o.id ? '…' : '拒绝'}
                  </GhostButton>
                  <PrimaryButton onClick={() => void accept(o.id)} loading={busy === o.id}>
                    立即接单
                  </PrimaryButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </TherapistShell>
  );
}
