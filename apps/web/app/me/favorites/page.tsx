/**
 * 我的收藏 · 客户端 · /me/favorites
 *
 * 数据源:GET /me/favorites(返收藏的技师 + JOIN users.display_name)
 * 操作:点击 card → 进技师详情 /therapist/[id] · 长按或右上角"⋯"取消收藏
 * 空态:还没收藏过技师 → 去发现
 */
'use client';

import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Heart, Inbox, MapPin } from 'lucide-react';
import { CustomerBottomNav } from '@/components/BottomNav';
import { Avatar } from '@/components/ui';
import { apiDelete } from '@/lib/api';
import { useState } from 'react';

interface FavoriteRow {
  id: string; // therapist id
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  nationality: string | null;
  languages: string[] | null;
  serviceCity: string | null;
  onlineStatus: string;
  scoreService: number;
  ratingCount: number;
  favoritedAt: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚收藏';
  if (min < 60) return `${min} 分钟前收藏`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前收藏`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前收藏`;
  return new Date(iso).toLocaleDateString();
}

export default function MyFavoritesPage() {
  const router = useRouter();
  const { data, error, isLoading } = useSWR<FavoriteRow[]>('/me/favorites');
  const list = data ?? null;
  const [busyId, setBusyId] = useState<string | null>(null);

  async function unfavorite(therapistId: string) {
    if (busyId) return;
    setBusyId(therapistId);
    try {
      await apiDelete(`/therapists/${therapistId}/favorite`);
      // 乐观更新 · 移除该条
      await mutate<FavoriteRow[]>(
        '/me/favorites',
        (curr) => (curr ?? []).filter((r) => r.id !== therapistId),
        { revalidate: false },
      );
      // 顶部 stat 也得刷
      await mutate('/dashboard/customer/me');
    } catch {
      // 失败 · revalidate 恢复
      await mutate('/me/favorites');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* 顶部 */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-warm-100 bg-white/95 px-3 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="返回"
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-600 active:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="flex-1 text-center text-[14.5px] font-semibold text-ink-900">
          我的收藏
          {list && list.length > 0 ? (
            <span className="ml-1.5 text-[11px] font-medium text-ink-400 num">{list.length}</span>
          ) : null}
        </h1>
        <div className="w-8" />
      </header>

      <section className="px-3 pt-3">
        {isLoading && list === null ? (
          <ul className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-white/60 p-3 shadow-warm-xs">
                <div className="h-14 w-14 shrink-0 rounded-full bg-warm-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-warm-100" />
                  <div className="h-3 w-2/3 rounded bg-warm-100/70" />
                </div>
              </li>
            ))}
          </ul>
        ) : error || (list && list.length === 0) ? (
          <div className="mt-12 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
              <Inbox className="h-7 w-7 text-warm-400" />
            </div>
            <div className="mt-3 text-serif-cn text-base font-semibold text-ink-900">
              还没收藏过技师
            </div>
            <div className="mt-1.5 max-w-[260px] text-[12px] leading-5 text-ink-500">
              在技师详情页点 ❤ 把她加进收藏 · 下次想约直接找她
            </div>
            <Link
              href="/discover"
              className="mt-4 inline-flex items-center gap-1 rounded-full bg-gradient-cta px-5 py-2 text-[12.5px] font-medium text-white shadow-rose-md active:scale-95"
            >
              去发现 →
            </Link>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-xs divide-y divide-warm-50">
            {(list ?? []).map((r, i) => (
              <li key={r.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 25, 180)}ms` }}>
                <FavoriteRow
                  row={r}
                  busy={busyId === r.id}
                  onUnfavorite={() => void unfavorite(r.id)}
                  onOpen={() => router.push(`/therapist/${r.id}`)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <CustomerBottomNav active="me" />
    </div>
  );
}

interface RowProps {
  row: FavoriteRow;
  busy: boolean;
  onOpen: () => void;
  onUnfavorite: () => void;
}

function FavoriteRow({ row, busy, onOpen, onUnfavorite }: RowProps) {
  const name = row.displayName ?? '匿名技师';
  const fallback = name.slice(0, 1);
  const score = row.scoreService ? (row.scoreService / 100).toFixed(1) : null;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick={onOpen} className="flex flex-1 items-center gap-3 text-left active:opacity-80">
        <div className="relative shrink-0">
          <Avatar size={56} src={row.avatarUrl ?? undefined} fallback={fallback} />
          {row.onlineStatus === 'online' ? (
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-serif-cn text-[14.5px] font-semibold text-ink-900">{name}</span>
            {score ? (
              <span className="rounded-full bg-warm-50 px-1.5 py-0.5 text-[10px] font-medium text-warm-700">★ {score}</span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-500">
            {row.serviceCity ? (
              <>
                <MapPin className="h-3 w-3" />
                <span className="truncate">{row.serviceCity}</span>
              </>
            ) : null}
            {row.nationality ? <span className="truncate">· {row.nationality}</span> : null}
          </div>
          <div className="mt-0.5 text-[10px] text-ink-400">{relativeTime(row.favoritedAt)}</div>
        </div>
      </button>
      <button
        type="button"
        onClick={onUnfavorite}
        disabled={busy}
        aria-label="取消收藏"
        className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary transition active:bg-primary/10 disabled:opacity-50"
      >
        <Heart className="h-4 w-4 fill-primary" strokeWidth={0} />
      </button>
    </div>
  );
}
