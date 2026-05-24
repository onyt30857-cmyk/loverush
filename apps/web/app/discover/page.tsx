'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Avatar, Badge, EmptyState, ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, ApiClientError } from '@/lib/api';

interface Recommend {
  therapist_id: string;
  display_name: string | null;
  avatar_url: string | null;
  score_appearance: number;
  score_service: number;
  rating: number;
  service_city: string | null;
  online_status: string;
  match_score: number;
}

export default function DiscoverPage() {
  const [list, setList] = useState<Recommend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Recommend[]>('/assistant/recommend', { city: city || undefined, top_n: 20 });
      setList(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="发现技师">
      {/* 搜索条 */}
      <div className="bg-gradient-soft px-5 pb-4 pt-3">
        <div className="label-cormorant mb-2">DISCOVER · FIND YOUR MATCH</div>
        <div className="flex gap-2">
          <input
            className="input-field flex-1 shadow-warm-xs"
            placeholder="按城市筛选（曼谷 / 吉隆坡 / 深圳…）"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-2xl bg-gradient-cta px-5 text-sm font-semibold text-white shadow-rose-md"
          >
            搜索
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <LoadingFull />
      ) : list.length === 0 ? (
        <EmptyState title="暂无可用技师" hint="试试更换城市或稍后再来" icon="🌸" />
      ) : (
        <ul className="space-y-3 px-5 pb-6 pt-2">
          {list.map((t, i) => (
            <li key={t.therapist_id} style={{ animationDelay: `${i * 40}ms` }} className="animate-fade-up">
              <Link
                href={`/therapist/${t.therapist_id}`}
                className="flex items-center gap-3 rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-sm transition active:scale-[0.99]"
              >
                <div className="relative">
                  <Avatar src={t.avatar_url ?? undefined} size={64} />
                  {t.online_status === 'online' && (
                    <span className="absolute bottom-0 right-0 inline-flex h-3 w-3 items-center justify-center rounded-full bg-white">
                      <span className="h-2 w-2 rounded-full bg-success-500 animate-dot-pulse" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-serif-cn text-base font-semibold text-ink-800">
                      {t.display_name ?? '技师'}
                    </span>
                    {t.online_status === 'online' ? (
                      <Badge color="success">在线</Badge>
                    ) : t.match_score > 80 ? (
                      <span className="rounded-full bg-warm-100 px-2 py-0.5 text-[10px] font-medium text-warm-700">
                        ✨ 推荐
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-600">
                    <span className="flex items-center gap-1">
                      <span className="text-warning-500">★</span>
                      <span className="text-display font-bold text-ink-800 num">
                        {(t.score_service / 10).toFixed(1)}
                      </span>
                    </span>
                    {t.score_appearance > 0 && (
                      <span className="text-cormorant">
                        颜值 {(t.score_appearance / 10).toFixed(1)}
                      </span>
                    )}
                  </div>
                  {t.service_city && (
                    <div className="mt-1 text-[10px] text-cormorant">📍 {t.service_city}</div>
                  )}
                </div>
                <span className="text-ink-300">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
