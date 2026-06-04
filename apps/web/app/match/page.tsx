'use client';

/**
 * M04 · 对话式意图匹配页
 * 说一句"今天想找什么样的陪伴" → /match/conversational → Top3 + 可解释理由 + 换一批
 * 走 LLM 语义匹配(画像/意图 × 技师 persona),失败后端自动降级规则打分。
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Send } from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/api';
import { RecommendCard, type RecommendItem } from '@/components/RecommendCard';
import { CustomerBottomNav } from '@/components/BottomNav';

interface MatchCandidate {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  tags: string[];
  nationality: string | null;
  service_city: string | null;
  score_service: number;
  online: boolean;
  base_price: Array<{ duration: number; pricePoints?: number; priceFiat?: number; currencyCode?: string }>;
  match_score: number;
  reasons: string[];
}

const SUGGESTIONS = [
  '想找个温柔会聊天、能让我放松的姐姐',
  '肩颈很僵硬,想要力度大一点的深度按摩',
  '第一次来有点紧张,希望对方耐心、不要太多话',
  '想安静放松,不想聊天',
];

export default function MatchPage() {
  const [intent, setIntent] = useState('');
  const [results, setResults] = useState<MatchCandidate[] | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setLastQuery(q);
    try {
      const data = await apiPost<{ mode: string; candidates: MatchCandidate[] }>(
        '/match/conversational',
        { intent_text: q, top_n: 3 },
      );
      setResults(data.candidates);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  function toItem(c: MatchCandidate): RecommendItem {
    const bp = c.base_price?.[0];
    return {
      therapistId: c.id,
      displayName: c.display_name ?? '匿名',
      avatarUrl: c.avatar_url,
      serviceCity: c.service_city ?? c.nationality,
      scoreService: Math.round(c.score_service / 10), // 0-1000 → 0-100,组件再 /10 显 0-10
      pricePoints: bp?.pricePoints ?? null,
      priceFiat: bp?.priceFiat ?? null,
      currencyCode: bp?.currencyCode ?? null,
      reason: c.reasons?.[0] ?? null,
      matchFactors: c.reasons ?? null, // 点 info 展开看全部理由
      availableNow: c.online,
    };
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* Header */}
      <header className="flex items-center gap-2 px-4 pt-5">
        <Link
          href="/home"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-warm-xs active:scale-95"
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4 text-ink-700" />
        </Link>
        <h1 className="text-serif-cn text-base font-semibold text-ink-900">智能匹配</h1>
      </header>

      {/* 意图输入 */}
      <section className="px-4 pt-4">
        <div className="flex items-center gap-1.5 text-serif-cn text-[17px] font-semibold text-ink-900">
          <Sparkles className="h-4 w-4 text-warm-500" /> 今天想找什么样的陪伴?
        </div>
        <div className="mt-2.5 rounded-2xl bg-white p-2.5 shadow-warm-xs">
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="用自己的话说,比如:想找个温柔会聊天、能让我放松的姐姐"
            rows={2}
            className="w-full resize-none bg-transparent px-1.5 py-1 text-[13.5px] leading-6 text-ink-800 outline-none placeholder:text-ink-300"
          />
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => run(intent)}
              disabled={loading || !intent.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-cta px-4 py-1.5 text-[12.5px] font-medium text-white shadow-warm-sm transition active:scale-95 disabled:opacity-40"
            >
              {loading ? '匹配中…' : (<><Send className="h-3.5 w-3.5" /> 帮我找</>)}
            </button>
          </div>
        </div>

        {/* 灵感提示 */}
        {!results && !loading && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setIntent(s);
                  void run(s);
                }}
                className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 shadow-warm-xs transition active:scale-95"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 结果 */}
      <section className="px-4 pb-24 pt-4">
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[120px] animate-pulse rounded-2xl bg-white/60 shadow-warm-xs" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-[12.5px] text-rose-600">
            没找到合适的:{error}
          </div>
        )}

        {!loading && results && results.length > 0 && (
          <>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="label-cormorant text-ink-500">为你挑了 {results.length} 位</div>
              <button
                type="button"
                onClick={() => run(lastQuery)}
                className="text-[12px] text-warm-600 active:scale-95"
              >
                换一批
              </button>
            </div>
            <div className="space-y-3">
              {results.map((c) => (
                <RecommendCard key={c.id} item={toItem(c)} variant="full" />
              ))}
            </div>
          </>
        )}

        {!loading && results && results.length === 0 && (
          <div className="mt-10 text-center text-[12.5px] text-ink-500">
            这会儿没匹配到合适的,换个说法或去
            <Link href="/home" className="text-warm-600"> 发现页 </Link>
            看看
          </div>
        )}
      </section>

      <CustomerBottomNav active="discover" />
    </div>
  );
}
