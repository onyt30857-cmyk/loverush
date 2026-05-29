/**
 * 搜索入口页 · Phase 1 MVP
 *
 * 业务定位:
 *   AI 助理 = 被动接受推荐
 *   搜索   = 主动查找(关键词 / 历史 / 热门 / 分类)
 *
 * 布局:
 *   顶部:返回 + 自动 focus input + 清空
 *   未输入:历史 chip(localStorage) + 热门 chip + 分类网格
 *   输入后:实时联想(300ms debounce)→ 点击跳详情或结果页
 *
 * 联想:实时 GET /therapists?search=xxx&limit=5
 */
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search as SearchIcon, X, Clock, Flame, Star } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiGet, ApiClientError } from '@/lib/api';

const HISTORY_KEY = 'search_history_v1';
const HISTORY_LIMIT = 5;

// 热门标签 · 后续可后端聚合
const TRENDING = ['今晚有空', '素坤逸', '中文', '新人', '评分高', '附近'];

const CATEGORIES: Array<{ label: string; icon: string; q: string }> = [
  { label: '泰式', icon: '🌿', q: '泰式' },
  { label: '油压', icon: '💆', q: '油压' },
  { label: '足疗', icon: '👣', q: '足疗' },
  { label: '新人', icon: '✨', q: '新人' },
  { label: '附近', icon: '📍', q: '附近' },
  { label: '今晚约', icon: '🌙', q: '今晚有空' },
];

interface SuggestItem {
  id: string;
  displayName: string | null;
  serviceCity: string | null;
  nationality: string | null;
  scoreService: number;
  heightCm: number | null;
}

function loadHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function pushHistory(q: string) {
  if (typeof window === 'undefined') return;
  if (!q.trim()) return;
  const cur = loadHistory();
  const next = [q, ...cur.filter((x) => x !== q)].slice(0, HISTORY_LIMIT);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 静默
  }
}

function clearHistory() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // 静默
  }
}

function SearchPageInner() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    // 自动 focus(等动画后)
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // debounce 联想
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await apiGet<SuggestItem[]>('/therapists', { search: query, limit: 5 });
        setSuggestions(list);
      } catch (err) {
        if (!(err instanceof ApiClientError)) {
          // 静默
        }
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function goSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    pushHistory(trimmed);
    router.push(`/search/results?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <AppShell fill hideTabBar>
      <div className="flex flex-1 flex-col bg-gradient-soft">
        {/* 顶部:返回 + input + 清空 */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-warm-100 bg-white/95 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="返回"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-700 active:bg-ink-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-2xl bg-ink-50 px-3 py-1.5">
            <SearchIcon className="h-4 w-4 text-ink-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  goSearch(query);
                }
              }}
              placeholder="搜技师名 · 城市 · 标签"
              aria-label="搜索"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink-800 outline-none placeholder:text-ink-400"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="清空"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-400 active:bg-ink-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* 联想模式:有输入 */}
          {query && (
            <section className="px-4 pt-4">
              <h2 className="mb-2 text-[12px] text-ink-500">联想</h2>
              {loading && <div className="text-[12px] text-ink-400">查询中...</div>}
              {!loading && suggestions.length === 0 && (
                <div className="rounded-xl bg-white px-4 py-3 text-[12px] text-ink-500 shadow-warm-xs">
                  没找到「{query}」相关 ·{' '}
                  <button
                    type="button"
                    onClick={() => goSearch(query)}
                    className="text-warm-600 underline"
                  >
                    仍要搜索
                  </button>
                </div>
              )}
              {suggestions.length > 0 && (
                <ul className="space-y-1.5">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/therapist/${s.id}`}
                        onClick={() => pushHistory(query)}
                        className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-warm-xs active:bg-warm-50"
                      >
                        <SearchIcon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-ink-800">
                            {s.displayName ?? '未填昵称'}
                          </div>
                          <div className="truncate text-[10.5px] text-ink-500">
                            {[s.serviceCity, s.nationality, s.heightCm ? `${s.heightCm}cm` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 text-[11px] text-warm-700">
                          <Star className="h-3 w-3 fill-warm-500 text-warm-500" />
                          {(s.scoreService / 10).toFixed(1)}
                        </div>
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => goSearch(query)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-warm-50 px-3 py-2.5 text-[12px] font-medium text-warm-700 active:bg-warm-100"
                    >
                      <SearchIcon className="h-3.5 w-3.5" />
                      查看全部「{query}」结果
                    </button>
                  </li>
                </ul>
              )}
            </section>
          )}

          {/* 默认模式:历史 + 热门 + 分类 */}
          {!query && (
            <>
              {history.length > 0 && (
                <section className="px-4 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="flex items-center gap-1 text-[12px] text-ink-500">
                      <Clock className="h-3 w-3" />
                      最近搜过
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        clearHistory();
                        setHistory([]);
                      }}
                      className="text-[11px] text-ink-400 active:text-ink-600"
                    >
                      清空
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {history.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          setQuery(h);
                          goSearch(h);
                        }}
                        className="rounded-full border border-warm-100 bg-white px-3 py-1 text-[12px] text-ink-700 active:bg-warm-50"
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="px-4 pt-4">
                <h2 className="mb-2 flex items-center gap-1 text-[12px] text-ink-500">
                  <Flame className="h-3 w-3 text-warm-500" />
                  大家在搜
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {TRENDING.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setQuery(t);
                        goSearch(t);
                      }}
                      className="rounded-full bg-warm-50 px-3 py-1 text-[12px] text-warm-700 active:bg-warm-100"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </section>

              <section className="px-4 py-4">
                <h2 className="mb-2 text-[12px] text-ink-500">按分类</h2>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => goSearch(c.q)}
                      className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-warm-100 bg-white py-4 shadow-warm-xs active:bg-warm-50 active:scale-95"
                    >
                      <span className="text-2xl">{c.icon}</span>
                      <span className="text-[11.5px] font-medium text-ink-700">{c.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<AppShell fill hideTabBar><div className="flex flex-1 bg-gradient-soft" /></AppShell>}>
      <SearchPageInner />
    </Suspense>
  );
}
