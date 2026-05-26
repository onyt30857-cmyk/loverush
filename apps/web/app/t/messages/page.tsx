'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { Avatar, EmptyState, LoadingFull } from '@/components/ui';
import { apiGet } from '@/lib/api';

interface Conv {
  id: string;
  customerId: string;
  therapistUserId: string;
  messageCount: number;
  lastMessageAt: string | null;
}

export default function TherapistMessagesPage() {
  const [list, setList] = useState<Conv[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<Conv[]>('/conversations');
        setList(data);
      } catch {
        setList([]); // API 失败也退出 loading，进入空状态而非永久白屏
      }
    })();
  }, []);

  if (!list) return <TherapistShell title="消息"><LoadingFull /></TherapistShell>;

  return (
    <TherapistShell title="消息">
      {list.length === 0 ? (
        <EmptyState title="还没有会话" icon="💬" />
      ) : (
        <ul>
          {list.map((c) => (
            <li key={c.id}>
              <Link
                href={`/t/messages/${c.id}`}
                className="flex items-center gap-3 border-b border-ink-100 px-5 py-3 active:bg-ink-50"
              >
                <Avatar size={48} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">客户 #{c.customerId.slice(0, 8)}</div>
                  <div className="text-xs text-ink-500">
                    {c.messageCount} 条 · {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : '尚无消息'}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TherapistShell>
  );
}
