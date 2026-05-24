'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { LoadingFull, EmptyState } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface ChainEvent {
  id: string;
  seq: number;
  event: string;
  payload: Record<string, unknown>;
  prevHash: string | null;
  eventHash: string;
  createdAt: string;
  actorRole: string | null;
}

interface VerifyResult {
  valid: boolean;
  brokenAtSeq?: number;
}

export default function ChainPage() {
  const { id } = useParams<{ id: string }>();
  const [events, setEvents] = useState<ChainEvent[] | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  useEffect(() => {
    void (async () => {
      const [list, v] = await Promise.all([
        apiGet<ChainEvent[]>(`/orders/${id}/chain`),
        apiGet<VerifyResult>(`/orders/${id}/chain/verify`),
      ]);
      setEvents(list);
      setVerify(v);
    })();
  }, [id]);

  if (!events) return <AppShell title="凭证链" showBack hideTabBar><LoadingFull /></AppShell>;

  return (
    <AppShell title="凭证链" showBack hideTabBar>
      <div className="px-5 py-4">
        {verify && (
          <div className={`mb-4 rounded-2xl p-3 text-sm ${verify.valid ? 'bg-success-500/10 text-success-500' : 'bg-primary/10 text-primary'}`}>
            {verify.valid ? '✓ 链完整，未被篡改' : `⚠️ 链不一致（在 seq ${verify.brokenAtSeq}）`}
          </div>
        )}
        {events.length === 0 ? (
          <EmptyState title="还没有事件" />
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="rounded-2xl border border-ink-100 bg-white p-3">
                <div className="flex items-center justify-between text-xs text-ink-500">
                  <span>#{e.seq} · {e.actorRole ?? 'system'}</span>
                  <span>{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{e.event}</div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-500">payload</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-ink-50 p-2 font-mono text-[10px]">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
                <div className="mt-2 truncate font-mono text-[10px] text-ink-300">{e.eventHash}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </AppShell>
  );
}
