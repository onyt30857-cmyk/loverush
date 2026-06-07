'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { EmptyState, ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { WalletLedger } from '@/components/wallet/WalletLedger';

interface Notif {
  id: string;
  title: string;
  body: string | null;
  category: string;
  level: string;
  readAt: string | null;
  createdAt: string;
  deepLink: string | null;
}

// deepLink 缺失时按 category 兜底(老通知 / 未带深链的系统通知)
function fallbackLink(n: Notif): string | null {
  switch (n.category) {
    case 'chat_msg':
      return '/conversations';
    default:
      return null;
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const [list, setList] = useState<Notif[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'list' | 'wallet'>('list');

  function openNotif(n: Notif) {
    // 乐观标已读(失败不回滚,下次 load 自纠)
    if (!n.readAt) {
      setList((prev) => (prev ? prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) : prev));
      void apiPost('/notifications/read', { notification_ids: [n.id] }).catch(() => {});
    }
    const link = n.deepLink ?? fallbackLink(n);
    if (link) router.push(link);
  }

  async function load() {
    const n = await apiGet<Notif[]>('/notifications', { limit: 30 }).catch(() => []); // 失败退出 loading，进入空状态
    setList(n);
  }

  useEffect(() => {
    void load();
  }, []);

  async function readAll() {
    try {
      await apiPost('/notifications/read-all');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (!list) return <AppShell title="通知" showBack hideTabBar><LoadingFull /></AppShell>;

  return (
    <AppShell title="通知" showBack hideTabBar>
      <div className="sticky top-12 z-10 grid grid-cols-2 border-b border-ink-100 bg-white">
        {(['list', 'wallet'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`py-2.5 text-sm ${tab === k ? 'border-b-2 border-primary font-medium text-primary' : 'text-ink-500'}`}
          >
            {k === 'list' ? '通知' : '流水'}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {tab === 'list' &&
        (list.length === 0 ? (
          <EmptyState
            title="还没有通知"
            hint="订单 / 私聊 / 派单 / 资金进出会通过这里告诉你"
            icon="🔕"
            action={
              <button
                type="button"
                onClick={() => setTab('wallet')}
                className="rounded-full bg-warm-50 px-4 py-1.5 text-[12px] font-medium text-ink-700 transition active:scale-95"
              >
                看看流水 →
              </button>
            }
          />
        ) : (
          <>
            <div className="px-5 py-3">
              <button type="button" onClick={() => void readAll()} className="text-xs text-primary">
                全部标已读
              </button>
            </div>
            <ul className="space-y-2 px-5 pb-6">
              {list.map((n) => {
                const link = n.deepLink ?? fallbackLink(n);
                return (
                  <li
                    key={n.id}
                    role={link ? 'button' : undefined}
                    tabIndex={link ? 0 : undefined}
                    onClick={() => openNotif(n)}
                    className={`rounded-2xl border p-3 ${n.readAt ? 'border-ink-100 bg-white' : 'border-primary/30 bg-primary/5'} ${link ? 'cursor-pointer transition active:scale-[0.98]' : ''}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="text-sm font-medium">{n.title}</div>
                      <span className="text-[10px] text-ink-300">
                        {new Date(n.createdAt).toLocaleString().slice(5, 16)}
                      </span>
                    </div>
                    {n.body && <div className="mt-1 text-xs text-ink-500">{n.body}</div>}
                    {link && <div className="mt-1.5 text-[11px] text-primary">查看详情 →</div>}
                  </li>
                );
              })}
            </ul>
          </>
        ))}

      {tab === 'wallet' && <WalletLedger />}
    </AppShell>
  );
}
