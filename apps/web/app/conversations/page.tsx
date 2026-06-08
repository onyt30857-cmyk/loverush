'use client';

// 2026-06-03 砍 CF 1 年 s-maxage prerender cache
//   client component 配合 dynamic='force-dynamic' · 阻止 SSG prerender 命中 CF 长缓存
//   命中现象:CF cache age 14h+ · HTML 引用旧 chunk URL · 用户拿不到新 build
//   代价:页面 SSR 每次跑 · TTI 慢 ~50ms · 但 conversation 列表本就 dynamic 数据 · 不该 prerender
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useServerEvents } from '@/lib/sse';
import Link from 'next/link';
import { Search, Inbox } from 'lucide-react';
import { CustomerBottomNav } from '@/components/BottomNav';
import { ConversationListItem } from '@/components/chat/ConversationListItem';
import { SwipeableTabs, type SwipeTab } from '@/components/ui/SwipeableTabs';
import { useDialog } from '@/components/UIDialog';
import { apiDelete, ApiClientError } from '@/lib/api';
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

/**
 * 单个 tab 面板:会话列表或空态。
 * 注:ConversationListItem 自带左滑删除(touch-action:pan-y 独占列表项水平手势),
 * 与外层横滑切 tab 天然不冲突 —— 列表项上左滑=删除,空白区横滑=切 tab,点击始终可用。
 */
function ConvPanel({
  items,
  unreadOnly,
  onDelete,
}: {
  items: Conv[];
  unreadOnly: boolean;
  onDelete: (c: Conv) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
          <Inbox className="h-7 w-7 text-warm-400" />
        </div>
        <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">
          {unreadOnly ? '没有未读会话' : '还没有会话'}
        </div>
        <div className="mt-1.5 text-[11px] text-ink-500">去发现页找个技师聊聊吧</div>
        <Link
          href="/discover"
          className="mt-4 rounded-full bg-gradient-cta px-5 py-2 text-[12px] font-medium text-white shadow-warm-md active:scale-95"
        >
          去发现
        </Link>
      </div>
    );
  }
  return (
    <section className="px-4 pt-1 pb-2">
      <ul className="overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-xs divide-y divide-warm-50">
        {items.map((c, i) => (
          <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 25, 180)}ms` }}>
            <ConversationListItem
              href={`/conversations/${c.id}`}
              counterpartyDisplayName={c.counterpartyDisplayName}
              counterpartyAvatarUrl={c.counterpartyAvatarUrl}
              fallbackName={`对话 ${c.id.slice(0, 6)}`}
              lastMessagePreview={c.lastMessagePreview}
              lastMessageAt={c.lastMessageAt}
              unreadCount={c.unreadCount ?? 0}
              onDelete={() => onDelete(c)}
            />
            {c.status === 'blocked' ? (
              <div className="px-4 pb-2 -mt-1 text-[10px] text-rose-600">已封锁</div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ConversationListPage() {
  // SWR 缓存:同 key('/conversations') 二次进站 0ms 显旧数据 + 后台 revalidate
  // 错误兜底为空数组,避免永久 Loading;旧版 catch setList([]) 行为保留
  const { data, error } = useSWR<Conv[]>('/conversations');

  const { confirm } = useDialog();

  /**
   * 左滑删除会话(iOS 标准 swipe-to-delete · 露出红色'删除'按钮)
   * - 乐观更新: 立刻从列表移除
   * - 失败回滚: revalidate 拉回原状
   * - per-user 软删: 只我看不到 · 对方仍可见 · 对方再发消息会自动复活
   */
  async function handleDelete(c: Conv) {
    const name = c.counterpartyDisplayName ?? '会话';
    const ok = await confirm({
      title: `删除「${name}」的会话?`,
      message: '只你看不到 · 对方仍可见 · 如果对方再发消息会重新出现',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    // 乐观写 SWR cache
    await mutate('/conversations', (cur: Conv[] | undefined) => (cur ?? []).filter((x) => x.id !== c.id), {
      revalidate: false,
    });
    try {
      await apiDelete(`/conversations/${c.id}`);
    } catch (err) {
      // 失败 · revalidate 拉回原状
      void mutate('/conversations');
      if (err instanceof ApiClientError) {
        console.error('[delete conversation failed]', err.payload.message);
      }
    }
  }

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

  // 搜索是跨 tab 全局过滤:先按搜索词过滤,unread panel 再额外 filter 未读
  const searchFiltered = list.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const inName = (c.counterpartyDisplayName ?? '').toLowerCase().includes(q);
    const inId = c.id.toLowerCase().includes(q);
    return inName || inId;
  });
  const unreadItems = searchFiltered.filter((c) => (c.unreadCount ?? 0) > 0);
  const unreadCount = list.filter((c) => (c.unreadCount ?? 0) > 0).length;

  const TABS: SwipeTab[] = [
    { key: 'all', label: '全部', badge: list.length },
    { key: 'unread', label: '有新消息', badge: unreadCount },
  ];

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Search(跨 tab 全局,留在横滑容器外) === */}
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

      <SwipeableTabs
        tabs={TABS}
        value={tab}
        onChange={(k) => setTab(k as 'all' | 'unread')}
        variant="pill"
        tabBarClassName="mt-3 px-4"
      >
        <ConvPanel items={searchFiltered} unreadOnly={false} onDelete={(c) => void handleDelete(c)} />
        <ConvPanel items={unreadItems} unreadOnly onDelete={(c) => void handleDelete(c)} />
      </SwipeableTabs>

      <CustomerBottomNav active="messages" />
    </div>
  );
}
