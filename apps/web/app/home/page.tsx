'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, MapPin, ChevronDown, Globe, Bell, Search, Sparkles, Star, Languages, Ruler, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { CustomerBottomNav } from '@/components/BottomNav';

interface Therapist {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  nationality: string | null;
  heightCm: number | null;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  rating: number;
  ratingCount: number;
  completedOrders: number;
  onlineStatus: string;
  tags: string[] | null;
  languages: string[] | null;
  basePriceJson: unknown;
}

interface ListResponse {
  data: Therapist[];
  meta?: { total: number };
}

const FILTER_CHIPS = [
  { icon: MapPin, label: '附近', sub: '3km', active: true },
  { icon: Languages, label: '语言' },
  { icon: null, label: '今晚可约', dot: true },
  { icon: Star, label: '9 分天花板' },
  { icon: Ruler, label: '165cm+' },
  { icon: Wallet, label: '< 5000 pts' },
  { icon: null, label: '泰式' },
  { icon: null, label: '油压' },
  { icon: null, label: 'SPA' },
];

export default function HomePage() {
  const router = useRouter();
  const [list, setList] = useState<Therapist[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = window.localStorage.getItem('access_token');
    if (!t) {
      router.replace('/');
      return;
    }
    void (async () => {
      try {
        const res = await apiGet<ListResponse>('/therapists?limit=20&online=true');
        setList(res.data ?? []);
        setTotal(res.meta?.total ?? res.data?.length ?? 0);
      } catch {
        // ignore for now
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const featured = list[0];
  const others = list.slice(1);

  return (
    <div className="mx-auto min-h-screen max-w-h5 bg-gradient-soft pb-20">
      {/* === Top nav === */}
      <nav className="sticky top-0 z-30 bg-white/85 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-cta shadow-warm-sm">
              <Heart className="h-4 w-4 fill-white text-white" />
            </div>
            <button className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 shadow-warm-xs">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              <span className="text-serif-cn text-[12px] font-medium text-ink-900">Bangkok · Asok</span>
              <ChevronDown className="h-3 w-3 text-ink-500" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-warm-xs">
              <Globe className="h-3.5 w-3.5 text-ink-700" />
            </button>
            <button className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-warm-xs">
              <Bell className="h-3.5 w-3.5 text-ink-700" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
            </button>
          </div>
        </div>
      </nav>

      {/* === 主标语 === */}
      <section className="px-5 pb-3 pt-3">
        <p className="mb-1.5 font-cormorant italic text-[10px] uppercase tracking-[0.3em] text-primary">
          Find the Right One
        </p>
        <h1 className="text-serif-cn text-[24px] font-semibold leading-tight text-ink-900">
          今晚，<span className="bg-gradient-cta bg-clip-text text-transparent">谁来温柔你</span>？
        </h1>
      </section>

      {/* === 搜索框 === */}
      <section className="px-4 pb-2">
        <div className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2.5 shadow-warm-xs">
          <Search className="h-4 w-4 text-ink-300" />
          <input
            type="text"
            placeholder="试试「曼谷 · 165cm · 中文」"
            className="flex-1 bg-transparent text-[13px] text-ink-800 outline-none placeholder:text-ink-300"
          />
          <button className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-cta">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
      </section>

      {/* === 在线数据条 === */}
      <div className="flex items-center justify-between px-5 pb-2 pt-3 text-[11px] text-ink-700">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="num text-[14px] font-semibold text-ink-900">{list.filter(t => t.onlineStatus === 'online').length}</span>
          <span>位 · 在线等你</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Heart className="h-3 w-3 text-primary" />
          <span className="num text-[14px] font-semibold text-ink-900">{total}</span>
          <span>位绝色佳人</span>
        </span>
      </div>

      {/* === 筛选 chips · 横滑 === */}
      <div className="sticky top-14 z-20 bg-gradient-soft/95 backdrop-blur-sm">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2">
          {FILTER_CHIPS.map((f, i) => (
            <button
              key={i}
              className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] ${
                f.active
                  ? 'bg-gradient-cta text-white shadow-warm-sm'
                  : 'bg-white text-ink-700 shadow-warm-xs'
              }`}
            >
              {f.dot && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              {f.icon && <f.icon className="h-3 w-3" />}
              <span>{f.label}</span>
              {f.sub && <span className="text-[10px] opacity-80">{f.sub}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* === 今日精选 banner === */}
      {!loading && featured && (
        <section className="px-4 pb-2 pt-3">
          <Link
            href={`/therapist/${featured.id}`}
            className="relative block aspect-[5/3] overflow-hidden rounded-3xl bg-ink-100 shadow-warm-md"
          >
            {featured.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={featured.avatarUrl} alt="" className="h-full w-full object-cover" style={{ objectPosition: 'center 20%' }} />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-medium text-white">
              <Star className="h-3 w-3 fill-white" />
              今夜独宠 · 仅 1 位
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-serif-cn text-xl font-semibold text-white">{featured.displayName}</span>
                <span className="font-display italic text-[13px] text-white/85">{featured.nationality}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/85">
                <MapPin className="h-3 w-3" />
                <span>{[featured.serviceCity, featured.serviceArea].filter(Boolean).join(' · ')}</span>
                <span className="mx-1">·</span>
                <Star className="h-3 w-3 fill-warning-500 text-warning-500" />
                <span className="num">{((featured.scoreAppearance + featured.scoreBody + featured.scoreService) / 300).toFixed(1)}</span>
              </div>
            </div>
          </Link>
        </section>
      )}

      {/* === 章节标题 === */}
      <section className="px-4 pb-2 pt-4">
        <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">
          Picked for You · {total}
        </div>
        <h2 className="text-serif-cn text-lg font-semibold text-ink-900">为你精选</h2>
      </section>

      {/* === 技师瀑布流 (2 列) === */}
      <section className="px-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-ink-100" />
            ))}
          </div>
        ) : others.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-ink-500">
            暂无在线技师 · 稍后再来看看
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {others.map((t) => (
              <TherapistCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </section>

      <CustomerBottomNav active="discover" />
    </div>
  );
}

function TherapistCard({ t }: { t: Therapist }) {
  const score = ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
  const priceTiers = (Array.isArray(t.basePriceJson) ? t.basePriceJson : []) as Array<{ duration: number; pricePoints: number }>;
  const minPrice = priceTiers.length > 0 ? Math.min(...priceTiers.map(p => p.pricePoints)) : null;
  return (
    <Link href={`/therapist/${t.id}`} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-ink-100">
        {t.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
        {t.onlineStatus === 'online' && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
            <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
            在线
          </span>
        )}
        <div className="absolute left-2 bottom-2 right-2">
          <div className="flex items-baseline gap-1">
            <span className="text-serif-cn text-[13px] font-semibold text-white drop-shadow">{t.displayName}</span>
            {t.heightCm && <span className="num text-[10px] text-white/85 drop-shadow">{t.heightCm}cm</span>}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px]">
        <span className="flex items-center gap-1 text-ink-700">
          <Star className="h-3 w-3 fill-warning-500 text-warning-500" />
          <span className="num font-semibold">{score}</span>
        </span>
        {minPrice !== null && (
          <span className="num font-display font-semibold text-primary">
            {minPrice}
            <span className="ml-0.5 text-[9px] text-ink-500">起</span>
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate px-0.5 text-[10px] text-ink-500">
        {[t.serviceCity, t.serviceArea].filter(Boolean).join(' · ')}
      </div>
    </Link>
  );
}

