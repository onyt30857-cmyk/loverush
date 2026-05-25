'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MessageCircle, Heart, Gift, MapPin, ChevronRight, Sparkles, Star, Check } from 'lucide-react';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface TherapistDetail {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  tags: string[] | null;
  languages: string[] | null;
  nationality: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bustCm: number | null;
  hipCm: number | null;
  bodyFatPct: string | number | null;
  education: string | null;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  rating: number;
  ratingCount: number;
  completedOrders: number;
  onlineStatus: string;
  galleryPublic: Array<{ url: string }>;
  galleryPaidCount: number;
  socialContacts?: Record<string, string>;
  basePriceJson?: Array<{ duration: number; pricePoints: number }> | unknown;
  preferencesJson?: unknown;
}

interface Preferences {
  preferredCustomerTypes?: string[];
  rejectedCustomerTypes?: string[];
  acceptableBehaviors?: string[];
  unacceptableBehaviors?: string[];
}

export default function TherapistProfile() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<TherapistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiGet<TherapistDetail>(`/therapists/${id}`);
      setT(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function openChat() {
    if (!t) return;
    try {
      const conv = await apiPost<{ id: string }>('/conversations', { therapist_user_id: t.userId });
      router.push(`/conversations/${conv.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (!t) {
    return (
      <div className="mx-auto max-w-h5 min-h-screen bg-white">
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </div>
    );
  }

  const overallScore = ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
  const heroAvatar = t.avatarUrl ?? '/placeholder-therapist.jpg';
  const langs = (t.languages ?? []).slice(0, 3);
  const tags = t.tags ?? [];
  const prefs = (t.preferencesJson ?? {}) as Preferences;
  const priceTiers = (Array.isArray(t.basePriceJson) ? t.basePriceJson : []) as Array<{ duration: number; pricePoints: number }>;

  return (
    <div className="mx-auto max-w-h5 min-h-screen bg-white pb-24">
      {/* === Top Nav (浮层 · 玻璃质感) === */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-50 text-ink-700 active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="font-cormorant italic text-[10px] tracking-[0.4em] text-ink-500/70">— LOVERUSH —</div>
        <div className="h-9 w-9" />
      </header>

      {/* === 标题区 === */}
      <section className="flex items-start justify-between px-5 pt-2">
        <div>
          <h1 className="font-serif-cn text-[28px] font-bold leading-tight text-ink-900">
            {t.displayName ?? '技师'}
          </h1>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-cormorant italic text-base text-ink-500">{t.nationality ?? 'Therapist'}</span>
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500">
              <Check className="h-2 w-2 text-white" strokeWidth={3.5} />
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display num text-3xl font-semibold text-ink-900">{overallScore}</div>
          <div className="font-cormorant italic text-[10px] tracking-[0.2em] text-ink-500">
            {t.ratingCount} reviews
          </div>
        </div>
      </section>

      {/* === Hero photo === */}
      <div className="mt-3 px-5">
        <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-ink-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroAvatar} alt={t.displayName ?? ''} className="h-full w-full object-cover" />
        </div>
      </div>

      {/* === Hero meta === */}
      <div className="mt-4 flex items-center justify-between px-5 text-[11px] text-ink-600">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${t.onlineStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-ink-300'}`} />
          {t.onlineStatus === 'online' ? '今晚在线' : '离线'}
        </span>
        <span className="h-3 w-px bg-ink-200" />
        <span className="num">{[t.heightCm && `${t.heightCm}cm`, t.nationality].filter(Boolean).join(' · ') || '—'}</span>
        <span className="h-3 w-px bg-ink-200" />
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {[t.serviceCity, t.serviceArea].filter(Boolean).join(' ') || '—'}
        </span>
      </div>

      {/* === Info card · 语言/类型 tags === */}
      {(langs.length > 0 || tags.length > 0) && (
        <div className="mx-5 mt-4 rounded-2xl border border-warm-100 bg-warm-50/30 p-3">
          <div className="flex flex-wrap gap-1.5">
            {langs.map((l) => (
              <span key={l} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-medium text-blue-600">
                {l === 'zh' ? '中文' : l === 'en' ? '英文' : l === 'th' ? '泰文' : l === 'vi' ? '越南文' : l === 'ms' ? '马来文' : l === 'id' ? '印尼文' : l}
              </span>
            ))}
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-warm-100 px-2.5 py-0.5 text-[10px] font-medium text-warm-700">
                {tag}
              </span>
            ))}
            {t.completedOrders > 20 && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600">
                {t.completedOrders} 次服务
              </span>
            )}
          </div>
        </div>
      )}

      <ErrorBanner message={error} />

      {/* === 相册（简版 grid · v1.0 不做 tab/lightbox） === */}
      {t.galleryPublic.length > 0 && (
        <section className="mt-6 px-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">MEDIA</div>
              <h2 className="font-serif-cn text-lg font-semibold text-ink-900">相册</h2>
            </div>
            <span className="flex items-center gap-1 font-cormorant italic text-[10px] text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Set by {t.displayName}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {t.galleryPublic.slice(0, 6).map((g, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={g.url} alt="" className="aspect-square rounded-xl object-cover" />
            ))}
          </div>
        </section>
      )}

      {/* === 关于 · Her Words === */}
      {t.bio && (
        <section className="mt-6 px-5">
          <div className="mb-3">
            <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">ABOUT HER</div>
            <h2 className="font-serif-cn text-lg font-semibold text-ink-900">遇见她</h2>
          </div>
          <div className="rounded-2xl border border-warm-200/40 bg-gradient-to-br from-warm-50 to-rose-50 p-4">
            <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-primary">HER WORDS</div>
            <p className="mt-1.5 font-serif-cn text-[13.5px] leading-7 text-ink-800">{t.bio}</p>
          </div>
        </section>
      )}

      {/* === 基础数据 · 5 维身体 === */}
      <section className="mt-5 px-5">
        <h3 className="mb-2 font-serif-cn text-xs font-semibold text-ink-700">
          基础数据 <span className="ml-1 font-cormorant italic text-[10px] tracking-wider text-ink-500/70">DATA</span>
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Height', t.heightCm && `${t.heightCm} cm`],
            ['Weight', t.weightKg && `${t.weightKg} kg`],
            ['Bust', t.bustCm && `${t.bustCm} cm`],
            ['Hip', t.hipCm && `${t.hipCm} cm`],
            ['Body Fat', t.bodyFatPct && `${t.bodyFatPct}%`],
            ['Education', t.education],
            ['Languages', langs.length > 0 ? langs.map(l => l === 'zh' ? '中' : l === 'en' ? '英' : l === 'th' ? '泰' : l).join(' · ') : null],
            ['Nationality', t.nationality],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
              <div className="font-cormorant italic text-[9px] tracking-wider text-ink-500/70">{label}</div>
              <div className="num mt-0.5 text-[13px] font-medium text-ink-900">{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* === 风格 / 边界 === */}
      {prefs && (
        <section className="mt-5 px-5">
          <h3 className="mb-2 font-serif-cn text-xs font-semibold text-ink-700">
            她的风格 <span className="ml-1 font-cormorant italic text-[10px] tracking-wider text-ink-500/70">STYLE</span>
          </h3>
          <div className="space-y-2.5">
            {prefs.preferredCustomerTypes && prefs.preferredCustomerTypes.length > 0 && (
              <div className="rounded-2xl border border-warm-100 bg-warm-50/40 p-3">
                <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-primary">SHE LIKES</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {prefs.preferredCustomerTypes.map((x) => (
                    <span key={x} className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-warm-700">{x}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {prefs.acceptableBehaviors && prefs.acceptableBehaviors.length > 0 && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-3">
                  <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-emerald-600">WELCOME</div>
                  <ul className="mt-1.5 space-y-0.5 text-[12px] leading-6 text-ink-800">
                    {prefs.acceptableBehaviors.map((x) => <li key={x}>· {x}</li>)}
                  </ul>
                </div>
              )}
              {prefs.unacceptableBehaviors && prefs.unacceptableBehaviors.length > 0 && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/30 p-3">
                  <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-rose-500">NO WAY</div>
                  <ul className="mt-1.5 space-y-0.5 text-[12px] leading-6 text-ink-800">
                    {prefs.unacceptableBehaviors.map((x) => <li key={x}>· {x}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* === 评价 · 三维评分横条 + AI 摘要 === */}
      <section className="mt-6 px-5">
        <div className="mb-3">
          <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">REVIEWS &amp; SCORE</div>
          <h2 className="font-serif-cn text-lg font-semibold text-ink-900">男人们怎么说</h2>
        </div>

        <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-warm-xs">
          {[
            { cn: '颜值', en: 'Appearance', value: t.scoreAppearance },
            { cn: '身材', en: 'Figure', value: t.scoreBody },
            { cn: '服务', en: 'Service', value: t.scoreService },
          ].map((s) => (
            <div key={s.cn} className="mb-2.5 flex items-center gap-3 last:mb-0">
              <div className="w-[60px]">
                <div className="font-serif-cn text-sm font-medium text-ink-900">{s.cn}</div>
                <div className="font-cormorant italic text-[10px] text-ink-500">{s.en}</div>
              </div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-warm-300 via-primary to-rose-500"
                  style={{ width: `${(s.value / 1000) * 100}%` }}
                />
              </div>
              <div className="num font-display text-base font-semibold text-ink-900">
                {(s.value / 100).toFixed(1)}
              </div>
            </div>
          ))}
        </div>
        {t.ratingCount > 0 && (
          <div className="mt-3 text-center font-cormorant italic text-[10px] tracking-[0.25em] text-ink-500">
            Based on <span className="font-semibold text-primary">{t.ratingCount}</span> reviews
          </div>
        )}

        {/* AI 摘要卡（v5 政策：不显示 "AI" 字样，标题用 INSIGHTS 替代） */}
        {t.completedOrders > 5 && (
          <div className="mt-3 rounded-2xl border border-warm-100 bg-gradient-to-br from-warm-50 to-rose-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-cta">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-cormorant italic text-xs tracking-[0.25em] text-warm-700">INSIGHTS</span>
            </div>
            <p className="font-serif-cn text-[13.5px] italic leading-7 text-ink-900">
              <span className="font-semibold text-primary">「会让你舍不得走」</span>是熟客的原话。
              手法温柔精准，
              <span className="font-semibold text-primary">{Math.round((t.completedOrders / Math.max(t.ratingCount, 1)) * 100)}% 的男人来了第二次</span>。
            </p>
          </div>
        )}
      </section>

      {/* === 服务 · 套餐列表 === */}
      {priceTiers && priceTiers.length > 0 && (
        <section className="mt-6 px-5">
          <div className="mb-3">
            <div className="font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">HER SERVICES</div>
            <h2 className="font-serif-cn text-lg font-semibold text-ink-900">为你准备的</h2>
          </div>
          <div className="space-y-2.5">
            {priceTiers.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => router.push(`/therapist/${t.id}/order?duration=${p.duration}`)}
                className={`flex w-full items-center justify-between rounded-2xl border bg-white px-4 py-3.5 text-left transition active:scale-[0.98] ${
                  i === 0 ? 'border-warm-200 shadow-warm-sm' : 'border-ink-100'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-serif-cn text-base font-semibold text-ink-900">
                      {p.duration} 分钟
                    </span>
                    {i === 0 && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-cormorant text-[9px] font-medium tracking-wider text-primary">
                        SIGNATURE
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-500">推荐套餐</div>
                </div>
                <div className="text-right">
                  <div className="num font-display text-xl font-semibold leading-none text-primary">
                    {p.pricePoints}
                  </div>
                  <div className="mt-1 text-[9px] tracking-wider text-ink-500/70">积分</div>
                </div>
                <ChevronRight className="ml-2 h-4 w-4 text-ink-500/70" />
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 text-center font-cormorant italic text-[9px] tracking-[0.4em] text-ink-500/70">
        — LOVERUSH —
      </div>

      {/* === 底部 sticky CTA · 三按钮 === */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-h5 bg-white/95 backdrop-blur-md">
        <div className="border-t border-ink-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void openChat()}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warm-50 active:scale-95"
              aria-label="私聊"
            >
              <MessageCircle className="h-5 w-5 text-primary" />
            </button>
            <button
              type="button"
              onClick={() => router.push(`/therapist/${t.id}/order`)}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-cta text-white shadow-warm-md active:scale-95"
            >
              <Heart className="h-4 w-4 fill-white" />
              <span className="font-serif-cn text-sm font-medium tracking-wider">锁定她 · 别让人抢走</span>
            </button>
            <button
              type="button"
              onClick={() => router.push(`/therapist/${t.id}/order?tip=1`)}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warm-50 active:scale-95"
              aria-label="给小费"
            >
              <Gift className="h-5 w-5 text-amber-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
