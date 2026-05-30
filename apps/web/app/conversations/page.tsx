'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useServerEvents } from '@/lib/sse';
import Link from 'next/link';
import { Search, Inbox } from 'lucide-react';
import { CustomerBottomNav } from '@/components/BottomNav';
import { ConversationListItem } from '@/components/chat/ConversationListItem';
import Loading from './loading';

interface Conv {
  id: string;
  customerId: string;
  therapistUserId: string;
  messageCount: number;
  lastMessageAt: string | null;
  status: string;
  unreadCount: number;
  lastMessagePreview: { senderUserId: string; body: string; sentAt: string; isEncrypted: boolean } | null;
  // 后端新增 · 对方身份
  counterpartyUserId: string;
  counterpartyDisplayName: string | null;
  counterpartyAvatarUrl: string | null;
}

export default function ConversationListPage() {
  // SWR 缓存:同 key('/conversations') 二次进站 0ms 显旧数据 + 后台 revalidate
  // 错误兜底为空数组,避免永久 Loading;旧版 catch setList([]) 行为保留
  const { data, error } = useSWR<Conv[]>('/conversations');

  // M05 Phase 2 · SSE 任一新消息触发列表 mutate(新未读数 + 顺序)
  useServerEvents((event) => {
    if (event === 'chat_message' || event === 'unread_change') {
      void mutate('/conversations');
    }
  });
  const list = error ? [] : data ?? null;
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');

  if (!list) return <Loading />;

  const filtered = list.filter((c) => {
    if (tab === 'unread' && (c.unreadCount ?? 0) === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      const inName = (c.counterpartyDisplayName ?? '').toLowerCase().includes(q);
      const inId = c.id.toLowerCase().includes(q);
      if (!inName && !inId) return false;
    }
    return true;
  });

  const unreadCount = list.filter((c) => (c.unreadCount ?? 0) > 0).length;

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Search === */}
      <section className="px-4 pt-5">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 shadow-warm-xs">
          <Search className="h-4 w-4 text-ink-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜对话..."
            className="flex-1 bg-transparent text-[13px] text-ink-800 outline-none placeholder:text-ink-300"
          />
        </div>
      </section>

      {/* === Tabs === */}
      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto px-4">
        {(['all', 'unread'] as const).map((k) => {
          const isActive = tab === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition active:scale-95 ${
                isActive
                  ? 'bg-gradient-cta text-white shadow-warm-sm'
                  : 'bg-white text-ink-600 shadow-warm-xs'
              }`}
            >
              <span>{k === 'all' ? '全部' : '有新消息'}</span>
              <span className="num font-display text-[10px] opacity-85">
                {k === 'all' ? list.length : unreadCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* === List === */}
      <section className="px-4 pt-1">
        {filtered.length === 0 ? (
          <div className="mt-12 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
              <Inbox className="h-7 w-7 text-warm-400" />
            </div>
            <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">
              {tab === 'unread' ? '没有未读会话' : '还没有会话'}
            </div>
            <div className="mt-1.5 text-[11px] text-ink-500">去发现页找个技师聊聊吧</div>
            <Link
              href="/discover"
              className="mt-4 rounded-full bg-gradient-cta px-5 py-2 text-[12px] font-medium text-white shadow-warm-md active:scale-95"
            >
              去发现
            </Link>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-xs divide-y divide-warm-50">
            {filtered.map((c, i) => (
              <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 25, 180)}ms` }}>
                <ConversationListItem
                  href={`/conversations/${c.id}`}
                  counterpartyDisplayName={c.counterpartyDisplayName}
                  counterpartyAvatarUrl={c.counterpartyAvatarUrl}
                  fallbackName={`对话 ${c.id.slice(0, 6)}`}
                  lastMessagePreview={c.lastMessagePreview}
                  lastMessageAt={c.lastMessageAt}
                  unreadCount={c.unreadCount ?? 0}
                />
                {c.status === 'blocked' ? (
                  <div className="px-4 pb-2 -mt-1 text-[10px] text-rose-600">已封锁</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CustomerBottomNav active="messages" />
    </div>
  );
}
