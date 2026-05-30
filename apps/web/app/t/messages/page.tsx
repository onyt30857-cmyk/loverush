'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { TherapistShell } from '@/components/AppShell';
import { ConversationListItem } from '@/components/chat/ConversationListItem';
import { apiGet } from '@/lib/api';

interface Conv {
  id: string;
  customerId: string;
  therapistUserId: string;
  messageCount: number;
  lastMessageAt: string | null;
  status: string;
  unreadCount: number;
  lastMessagePreview: { senderUserId: string; body: string; sentAt: string; isEncrypted: boolean } | null;
  counterpartyUserId: string;
  counterpartyDisplayName: string | null;
  counterpartyAvatarUrl: string | null;
}

export default function TherapistMessagesPage() {
  const [list, setList] = useState<Conv[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<Conv[]>('/conversations');
        setList(data);
      } catch {
        setList([]);
      }
    })();
  }, []);

  return (
    <TherapistShell>
      <div className="min-h-full bg-gradient-soft">
        {list === null ? (
          <ul className="space-y-2 px-5 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-2xl bg-white/60 p-3 shadow-warm-xs"
              >
                <div className="h-12 w-12 shrink-0 rounded-full bg-warm-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-warm-100" />
                  <div className="h-3 w-2/3 rounded bg-warm-100/70" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.length === 0 ? (
          <div className="mt-12 flex flex-col items-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-warm-sm">
              <MessageCircle className="h-7 w-7 text-primary" />
            </div>
            <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">
              还没有会话
            </div>
            <div className="mt-1.5 text-[12px] leading-5 text-ink-500">
              客户来咨询后,对话会出现在这里
            </div>
            <Link
              href="/t/me/profile"
              className="mt-4 inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[12px] text-ink-700 shadow-warm-xs active:scale-95"
            >
              完善档案 · 提升被挑中概率 →
            </Link>
          </div>
        ) : (
          <ul className="mx-4 my-4 overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-xs divide-y divide-warm-50">
            {list.map((c) => (
              <li key={c.id}>
                <ConversationListItem
                  href={`/t/messages/${c.id}`}
                  counterpartyDisplayName={c.counterpartyDisplayName}
                  counterpartyAvatarUrl={c.counterpartyAvatarUrl}
                  fallbackName={`客户 ${c.customerId.slice(0, 6)}`}
                  lastMessagePreview={c.lastMessagePreview}
                  lastMessageAt={c.lastMessageAt}
                  unreadCount={c.unreadCount ?? 0}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </TherapistShell>
  );
}
