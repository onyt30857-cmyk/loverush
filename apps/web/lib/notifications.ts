/**
 * 通知未读数 hook · M13 home Bell 红点用
 *
 * 策略:home 加载时拉一次未读 · SWR 60s 缓存 · 不轮询
 * 失败静默(返 0)· 红点不显示 · 不阻塞 UI
 */
'use client';

import useSWR from 'swr';
import { apiGet } from './api';

interface UnreadNotif {
  id: string;
  readAt: string | null;
}

export function useUnreadCount(): { unreadCount: number; mutate: () => void } {
  const { data, mutate } = useSWR<UnreadNotif[]>(
    '/notifications?unread_only=true&limit=20',
    (url: string) => apiGet<UnreadNotif[]>(url).catch(() => [] as UnreadNotif[]),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );
  return { unreadCount: data?.length ?? 0, mutate };
}
