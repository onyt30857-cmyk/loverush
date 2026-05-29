/**
 * 搜索结果页 · Phase 1 MVP
 *
 * 路径:/search/results?q=<keyword>
 *
 * 布局:
 *   顶部:返回 + 当前 query 显示 + 编辑
 *   筛选条:城市 chip(初版只显示数)
 *   结果列表:技师卡 · 点跳详情
 *   空态:'没找到「xxx」相关 · 试试 [建议关键词]'
 */
'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Pencil, MessageCircle, Star, MapPin, Sparkles, X } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface ResultItem {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  serviceCity: string | null;
  nationality: string | null;
  scoreService: number;
  scoreAppearance: number;
  heightCm: number | null;
  rating: number;
  onlineStatus: string;
}

/** Phase 2 · 后端 NLP 解析结果 */
interface ParsedQuery {
  city?: string;
  height_min?: number;
  height_max?: number;
  nationality?: string;
  language?: string;
  skill?: string;
  online?: boolean;
  score_min?: number;
  search?: string;
  summary?: string;
  fallback?: boolean;
}

/** 把 parsed 转成 chip 数组 */
function parsedToChips(p: ParsedQuery): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  if (p.city) chips.push({ key: 'city', label: p.city });
  if (p.height_min && p.height_max) chips.push({ key: 'height', label: `${p.height_min}–${p.height_max}cm` });
  else if (p.height_min) chips.push({ key: 'height_min', label: `${p.height_min}cm+` });
  else if (p.height_max) chips.push({ key: 'height_max', label: `≤${p.height_max}cm` });
  if (p.nationality) chips.push({ key: 'nationality', label: p.nationality });
  if (p.language) chips.push({ key: 'language', label: p.language });
  if (p.skill) chips.push({ key: 'skill', label: p.skill });
  if (p.online) chips.push({ key: 'online', label: '在线' });
  if (p.score_min) chips.push({ key: 'score_min', label: `${(p.score_min / 10).toFixed(1)}★+` });
  if (p.search) chips.push({ key: 'search', label: `"${p.search}"` });
  return chips;
}

/** 把 parsed 转成 /therapists query params */
function parsedToQuery(p: ParsedQuery): Record<string, string | number | boolean> {
  const q: Record<string, string | number | boolean> = {};
  if (p.city) q.city = p.city;
  if (p.height_min) q.height_min = p.height_min;
  if (p.height_max) q.height_max = p.height_max;
  if (p.nationality) q.nationality = p.nationality;
  if (p.language) q.language = p.language;
  if (p.skill) q.skill = p.skill;
  if (p.online) q.online = 'true';
  if (p.score_min) q.score_min = p.score_min;
  if (p.search) q.search = p.search;
  return q;
}

function SearchResultsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';

  const [items, setItems] = useState<ResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 2 · NLP 解析结果
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [activeChips, setActiveChips] = useState<Array<{ key: string; label: string }>>([]);

  useEffect(() => {
    if (!q) {
      router.replace('/search');
      return;
    }
    setLoading(true);
    setError(null);

    // Phase 2 · 先调 NLP 解析 · 再用结构化条件查
    (async () => {
      try {
        // 1. NLP 解析
        const p = await apiPost<ParsedQuery>('/search/parse', { q }).catch(() => ({ search: q, fallback: true }) as ParsedQuery);
        setParsed(p);
        setActiveChips(parsedToChips(p));

        // 2. 用解析结果查
        const query = { ...parsedToQuery(p), limit: 30 };
        const list = await apiGet<ResultItem[]>('/therapists', query);
        setItems(list);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
        else setError('搜索出错 · 一会儿再试');
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [q, router]);

  // 用户点掉 chip → 重新查
  async function removeChip(chipKey: string) {
    if (!parsed) return;
    const newParsed = { ...parsed };
    if (chipKey === 'city') delete newParsed.city;
    if (chipKey === 'height' || chipKey === 'height_min') delete newParsed.height_min;
    if (chipKey === 'height' || chipKey === 'height_max') delete newParsed.height_max;
    if (chipKey === 'nationality') delete newParsed.nationality;
    if (chipKey === 'language') delete newParsed.language;
    if (chipKey === 'skill') delete newParsed.skill;
    if (chipKey === 'online') delete newParsed.online;
    if (chipKey === 'score_min') delete newParsed.score_min;
    if (chipKey === 'search') delete newParsed.search;
    setParsed(newParsed);
    setActiveChips(parsedToChips(newParsed));

    setLoading(true);
    try {
      const query = { ...parsedToQuery(newParsed), limit: 30 };
      const list = await apiGet<ResultItem[]>('/therapists', query);
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTotal(items.length);
  }, [items]);

  return (
    <AppShell fill hideTabBar>
      <div className="flex flex-1 flex-col bg-gradient-soft">
        {/* 顶部 · 返回 + query 显示 + 编辑 */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-warm-100 bg-white/95 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="返回"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-700 active:bg-ink-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => router.push('/search')}
            className="flex flex-1 items-center justify-between gap-2 rounded-2xl bg-ink-50 px-3 py-1.5 active:bg-ink-100"
          >
            <span className="truncate text-[13.5px] text-ink-800">{q}</span>
            <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          </button>
        </header>

        {/* NLP 解析摘要 + chips · Phase 2 */}
        {parsed && !parsed.fallback && (
          <div className="px-4 pb-1 pt-3">
            {parsed.summary && (
              <div className="mb-1.5 flex items-center gap-1 text-[11.5px] text-ink-600">
                <Sparkles className="h-3 w-3 text-warm-500" />
                <span className="truncate">{parsed.summary}</span>
              </div>
            )}
            {activeChips.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {activeChips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => void removeChip(c.key)}
                    className="flex items-center gap-0.5 rounded-full bg-warm-50 px-2 py-0.5 text-[11px] text-warm-700 active:bg-warm-100"
                    aria-label={`移除 ${c.label}`}
                  >
                    {c.label}
                    <X className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 结果数 */}
        <div className="px-4 pb-1 pt-3 text-[11.5px] text-ink-500">
          {loading
            ? '查询中...'
            : error
              ? error
              : `找到 ${total} 位 · 按相关度排序`}
        </div>

        {/* 结果列表 */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {!loading && !error && items.length === 0 && (
            <div className="mt-6 rounded-2xl bg-white px-5 py-6 text-center shadow-warm-xs">
              <div className="mb-1 text-[14px] font-medium text-ink-700">没找到「{q}」相关</div>
              <div className="mb-4 text-[12px] text-ink-500">换个关键词,或直接到发现页挑</div>
              <Link
                href="/home"
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-cta px-5 py-2 text-[12.5px] font-medium text-white shadow-rose-md active:scale-95"
              >
                看全部技师
              </Link>
            </div>
          )}

          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/therapist/${it.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-warm-xs active:bg-warm-50"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-warm-50">
                    {it.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.avatarUrl} alt={it.displayName ?? '技师'} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl">🙂</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate text-[14px] font-semibold text-ink-800">
                        {it.displayName ?? '未填昵称'}
                      </h3>
                      {it.onlineStatus === 'online' && (
                        <span className="online-dot" />
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
                      <span className="flex items-center gap-0.5 text-warm-700">
                        <Star className="h-3 w-3 fill-warm-500 text-warm-500" />
                        {(it.scoreService / 10).toFixed(1)}
                      </span>
                      {it.serviceCity && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {it.serviceCity}
                        </span>
                      )}
                      {it.heightCm && <span>{it.heightCm}cm</span>}
                      {it.nationality && <span>{it.nationality}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(`/assistant/chat?intent_seed=${encodeURIComponent(`聊聊 ${it.displayName ?? '这位'}`)}`);
                    }}
                    aria-label={`聊聊 ${it.displayName ?? '这位'}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warm-50 text-warm-700 active:bg-warm-100"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}

export default function SearchResultsPage() {
  return (
    <Suspense fallback={<AppShell fill hideTabBar><div className="flex flex-1 bg-gradient-soft" /></AppShell>}>
      <SearchResultsInner />
    </Suspense>
  );
}
