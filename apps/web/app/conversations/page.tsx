'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Avatar, EmptyState, LoadingFull } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface Conv {
  id: string;
  customerId: string;
  therapistUserId: string;
  messageCount: number;
  lastMessageAt: string | null;
  status: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '尚无消息';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationListPage() {
  const [list, setList] = useState<Conv[] | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await apiGet<Conv[]>('/conversations');
      setList(data);
    })();
  }, []);

  if (!list) return <AppShell title="消息"><LoadingFull /></AppShell>;

  return (
    <AppShell title="消息">
      <div className="bg-gradient-soft px-5 pb-3 pt-2">
        <div className="label-cormorant">MESSAGES · YOUR CONVERSATIONS</div>
      </div>

      {list.length === 0 ? (
        <EmptyState title="还没有会话" hint="去发现页找个技师聊聊吧" icon="💬" />
      ) : (
        <ul className="divide-y divide-warm-100">
          {list.map((c, i) => (
            <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
              <Link
                href={`/conversations/${c.id}`}
                className="flex items-center gap-3 px-5 py-3 transition active:bg-warm-50"
              >
                <Avatar size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-serif-cn text-[15px] font-semibold text-ink-800">
                      会话 · {c.id.slice(0, 6)}
                    </span>
                    <span className="text-[10px] text-ink-600">{relativeTime(c.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-600">
                    <span className="text-cormorant">{c.messageCount} messages</span>
                    {c.status === 'blocked' && (
                      <span className="rounded-full bg-danger-500/10 px-1.5 py-0 text-[9px] text-danger-500">
                        已封锁
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
