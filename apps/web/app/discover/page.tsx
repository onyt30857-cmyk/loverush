'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Search,
  SlidersHorizontal,
  MapPin,
  Star,
} from 'lucide-react';
import { apiGet, ApiClientError } from '@/lib/api';
import { CustomerBottomNav } from '@/components/BottomNav';

interface Recommend {
  therapist_id: string;
  display_name: string | null;
  avatar_url: string | null;
  score_appearance: number;
  score_body?: number;
  score_service: number;
  rating: number;
  service_city: string | null;
  online_status: string;
  match_score: number;
}

const FILTER_CHIPS = [
  { label: '附近', key: 'near', active: true, sub: '3km' },
  { label: '在线', key: 'online', dot: true },
  { label: '9 分天花板', key: 'top' },
  { label: '165cm+', key: 'height' },
  { label: '< 5000 pts', key: 'price' },
  { label: '泰式', key: 'thai' },
  { label: '油压', key: 'oil' },
  { label: 'SPA', key: 'spa' },
];

export default function DiscoverPage() {
  const [list, setList] = useState<Recommend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('near');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Recommend[]>('/assistant/recommend', {
        city: search || undefined,
        top_n: 20, // 后端 RecommendQuery.top_n 上限 max(20)，超出会 400
      });
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

  const onlineCount = list.filter((t) => t.online_status === 'online').length;
  // Apply client-side filter
  const filtered = list.filter((t) => {
    if (activeFilter === 'online') return t.online_status === 'online';
    if (activeFilter === 'top') return t.score_service >= 900;
    return true;
  });

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Top nav: 搜索框 + 筛选 button === */}
      <nav className="sticky top-0 z-30 flex items-center gap-2 bg-white/85 px-3 py-3 backdrop-blur-md">
        <Link
          href="/home"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-warm-xs">
          <Search className="h-4 w-4 text-ink-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            placeholder="城市 / 名字 / 关键词"
            className="flex-1 bg-transparent text-[13px] text-ink-800 outline-none placeholder:text-ink-300"
          />
        </div>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-white shadow-warm-md active:scale-95"
          title="筛选"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </nav>

      {/* === Stats strip === */}
      <div className="flex items-center justify-between px-5 py-3 text-[11px] text-ink-700">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="num text-[14px] font-semibold text-ink-900">{onlineCount}</span>
          <span>位 · 在线等你</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-cormorant italic text-[10px] tracking-[0.2em] text-ink-500">TOTAL</span>
          <span className="num text-[14px] font-semibold text-ink-900">{list.length}</span>
        </span>
      </div>

      {/* === Filter chips sticky === */}
      <div className="sticky top-[60px] z-20 bg-gradient-soft/95 backdrop-blur-sm">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2">
          {FILTER_CHIPS.map((f) => {
            const isActive = activeFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] transition active:scale-95 ${
                  isActive
                    ? 'bg-gradient-cta text-white shadow-warm-sm'
                    : 'bg-white text-ink-700 shadow-warm-xs'
                }`}
              >
                {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-emerald-500'}`} />}
                <span>{f.label}</span>
                {f.sub && <span className="text-[10px] opacity-80">{f.sub}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          {error}
        </div>
      )}

      {/*
        H5 修复 · 动态布局
        ≤ 3 个:单列大卡(aspect-[4/5]) + 底部引导文,避免 2 列网格 2+1+大空白
        >  3 个:走标准 2 列网格
      */}
      <section className="px-4 pb-6 pt-2">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-ink-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-warm-200 bg-white/60 px-6 py-12 text-center backdrop-blur-sm">
            <div className="text-4xl">🌸</div>
            <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">暂无可用技师</div>
            <div className="mt-1.5 text-[12px] text-ink-500">试试更换城市或换个筛选条件</div>
          </div>
        ) : filtered.length <= 3 ? (
          <>
            <div className="space-y-3">
              {filtered.map((t, i) => (
                <BigCard key={t.therapist_id} t={t} delayMs={Math.min(i * 40, 160)} />
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-dashed border-warm-200 bg-white/50 px-5 py-5 text-center backdrop-blur-sm">
              <div className="text-serif-cn text-[13px] font-medium text-ink-800">就这几位符合</div>
              <div className="mt-1 text-[12px] text-ink-500">放宽筛选或换个城市,会有更多选项</div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((t, i) => (
              <Card key={t.therapist_id} t={t} delayMs={Math.min(i * 30, 240)} />
            ))}
          </div>
        )}
      </section>

      <CustomerBottomNav active="discover" />
    </div>
  );
}

function Card({ t, delayMs }: { t: Recommend; delayMs: number }) {
  const overall = ((t.score_appearance + (t.score_body ?? 0) + t.score_service) / 300).toFixed(1);
  return (
    <Link
      href={`/therapist/${t.therapist_id}`}
      className="group block animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-ink-100 shadow-warm-xs">
        {t.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🌸</div>
        )}

        {/* 在线徽章 */}
        {t.online_status === 'online' && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[9px] font-semibold text-ink-900 backdrop-blur">
            <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-500" />
            在线
          </div>
        )}

        {/* 评分徽章 */}
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 backdrop-blur">
          <Star className="h-2.5 w-2.5 fill-warning-500 text-warning-500" />
          <span className="num text-[10px] font-bold text-ink-900">{overall}</span>
        </div>

        {/* 名字 + 城市 overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
          <div className="text-serif-cn text-[13px] font-semibold text-white drop-shadow">{t.display_name ?? '技师'}</div>
          {t.service_city && (
            <div className="mt-0.5 flex items-center gap-0.5 text-[10px] text-white/85">
              <MapPin className="h-2.5 w-2.5" />
              {t.service_city}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// 单列大卡 · 用于 ≤ 3 个结果时(避免 2 列网格不平衡)
function BigCard({ t, delayMs }: { t: Recommend; delayMs: number }) {
  const overall = ((t.score_appearance + (t.score_body ?? 0) + t.score_service) / 300).toFixed(1);
  return (
    <Link
      href={`/therapist/${t.therapist_id}`}
      className="group block animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-ink-100 shadow-warm-sm">
        {t.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl">🌸</div>
        )}

        {t.online_status === 'online' && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-ink-900 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            在线
          </div>
        )}

        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 backdrop-blur">
          <Star className="h-3 w-3 fill-warning-500 text-warning-500" />
          <span className="num text-[11px] font-bold text-ink-900">{overall}</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4">
          <div className="text-serif-cn text-[18px] font-semibold text-white drop-shadow">
            {t.display_name ?? '技师'}
          </div>
          {t.service_city && (
            <div className="mt-1 flex items-center gap-1 text-[12px] text-white/90">
              <MapPin className="h-3 w-3" />
              {t.service_city}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

