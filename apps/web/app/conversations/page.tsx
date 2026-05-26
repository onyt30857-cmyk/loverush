'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Search,
  Inbox,
  User,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { LoadingFull } from '@/components/ui';
import { CustomerBottomNav } from '@/components/BottomNav';

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
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    void (async () => {
      const data = await apiGet<Conv[]>('/conversations');
      setList(data);
    })();
  }, []);

  if (!list) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <LoadingFull />
      </div>
    );
  }

  const filtered = list.filter((c) => {
    if (tab === 'unread' && c.messageCount === 0) return false;
    if (search && !c.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const unreadCount = list.filter((c) => c.messageCount > 0).length;

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Top nav === */}
      <header className="sticky top-0 z-30 flex items-center bg-white/85 px-4 py-3 backdrop-blur-md">
        <div className="flex-1">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">私聊</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">MESSAGES</div>
        </div>
      </header>

      {/* === Search === */}
      <section className="px-4 pt-3">
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
      <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto px-4 py-2">
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
          <ul className="space-y-2">
            {filtered.map((c, i) => (
              <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}>
                <Link
                  href={`/conversations/${c.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-xs transition active:scale-[0.99]"
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-cta">
                    <div className="flex h-full w-full items-center justify-center text-white">
                      <User className="h-6 w-6" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-serif-cn text-[14px] font-semibold text-ink-900">
                        对话 · {c.id.slice(0, 6)}
                      </span>
                      <span className="shrink-0 font-cormorant italic text-[10px] tracking-wider text-ink-500">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-500">
                      <span className="num">{c.messageCount} 条消息</span>
                      {c.status === 'blocked' && (
                        <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-medium text-rose-600">
                          已封锁
                        </span>
                      )}
                    </div>
                  </div>
                  {c.messageCount > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gradient-cta px-1.5 text-[10px] font-semibold text-white">
                      {c.messageCount > 99 ? '99+' : c.messageCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CustomerBottomNav active="messages" />
    </div>
  );
}
