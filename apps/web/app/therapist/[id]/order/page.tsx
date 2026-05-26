'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, X, Heart, Info, ChevronRight } from 'lucide-react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { ErrorBanner, LoadingFull } from '@/components/ui';

interface TherapistMini {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  basePriceJson?: unknown;
  skillsJson?: unknown;
}

const INCLUDED_ITEMS = [
  { name: '精油', desc: '高端进口品牌' },
  { name: '毛巾 · 床品', desc: '一客一换' },
  { name: '热敷', desc: '服务前后供应' },
];

const NOT_INCLUDED = [
  { name: '加钟 / 私密服务', desc: '本店不接 · 请勿提出' },
];

const TIP_OPTIONS = [0, 50, 100, 200];

export default function PriceLockPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<TherapistMini | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [tip, setTip] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<TherapistMini>(`/therapists/${id}`);
        setT(data);
        const tiers = Array.isArray(data.basePriceJson) ? data.basePriceJson : [];
        const first = tiers[0] as { duration: number } | undefined;
        if (first) setSelectedDuration(first.duration);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [id]);

  if (!t) {
    return (
      <div className="mobile-container bg-white">
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </div>
    );
  }

  const priceTiers = (Array.isArray(t.basePriceJson) ? t.basePriceJson : []) as Array<{ duration: number; pricePoints: number }>;
  const skills = (Array.isArray(t.skillsJson) ? t.skillsJson : []) as Array<{ skill: string; level: number }>;
  const priceOption = priceTiers.find((p) => p.duration === selectedDuration);
  const basePoints = priceOption?.pricePoints ?? 0;
  const totalPoints = basePoints + tip;

  function toggleSkill(s: string) {
    setSelectedSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submit() {
    if (!priceOption) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await apiPost<{ id: string }>('/orders', {
        therapist_id: t!.id,
        service_snapshot: {
          skills: selectedSkills,
          durationMin: priceOption.duration,
          pricePoints: basePoints,
          itemsBreakdown: tip > 0 ? [{ name: '小费', pricePoints: tip }] : undefined,
        },
      });
      await apiPost(`/orders/${order.id}/submit`);
      router.replace(`/order/${order.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft pb-32">
      {/* === Top nav === */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">服务确认</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">PRICE LOCK</div>
        </div>
        <div className="h-9 w-9" />
      </header>

      {/* === Tagline · "先标价 后服务 不加钟" 主标语 === */}
      <section className="px-5 pt-4 pb-3">
        <p className="mb-1.5 font-cormorant italic text-[10px] uppercase tracking-[0.3em] text-primary">
          真人 · 真美 · 真私密
        </p>
        <h1 className="text-serif-cn text-[24px] font-semibold leading-tight text-ink-900">
          <span className="bg-gradient-cta bg-clip-text text-transparent">先标价 · 后服务 · 不加钟</span>
        </h1>
        <p className="mt-2 text-[11px] text-ink-500">本页价格即最终结算价 · 任何加钟诱导都可投诉封号</p>
      </section>

      {/* === 技师小卡 === */}
      <section className="px-4 pb-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-warm-xs">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-ink-100">
            {t.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.avatarUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-serif-cn text-base font-semibold text-ink-900">{t.displayName ?? '技师'}</div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {[t.serviceCity, t.serviceArea, t.nationality].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      </section>

      {/* === 时长选择 === */}
      <section className="px-4 pb-3">
        <h3 className="mb-2 font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">
          DURATION · 时长
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {priceTiers.length === 0 && (
            <div className="col-span-2 rounded-2xl bg-white p-4 text-center text-xs text-ink-500">
              该技师未设置价格 · 联系技师确认
            </div>
          )}
          {priceTiers.map((p) => {
            const on = selectedDuration === p.duration;
            return (
              <button
                key={p.duration}
                type="button"
                onClick={() => setSelectedDuration(p.duration)}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition active:scale-[0.98] ${
                  on
                    ? 'border-primary bg-primary/5 shadow-warm-sm'
                    : 'border-ink-100 bg-white'
                }`}
              >
                <div>
                  <div className="text-serif-cn text-base font-semibold text-ink-900">{p.duration} 分钟</div>
                </div>
                <div className="text-right">
                  <div className="num font-display text-base font-semibold text-primary">{p.pricePoints}</div>
                  <div className="text-[9px] text-ink-500">积分</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* === 含项明细 (绿色对勾) === */}
      <section className="px-4 pb-2">
        <div className="rounded-2xl border-l-2 border-primary bg-white p-4 shadow-warm-xs">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-serif-cn text-sm font-semibold text-ink-900">含项 (本次包含)</span>
            <span className="font-cormorant italic text-[10px] tracking-wider text-emerald-600">INCLUDED</span>
          </div>
          <div className="space-y-2">
            {INCLUDED_ITEMS.map((i) => (
              <div key={i.name} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-3 w-3 text-emerald-600" />
                </span>
                <div className="flex-1">
                  <div className="text-[13px] text-ink-900">{i.name}</div>
                  <div className="text-[10px] text-ink-500">{i.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === 加项 (按需选 · skillsJson) === */}
      {skills.length > 0 && (
        <section className="px-4 pb-2">
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-serif-cn text-sm font-semibold text-ink-900">加项 (按需选)</span>
              <span className="font-cormorant italic text-[10px] tracking-wider text-warm-700">ADD-ONS</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {skills.slice(0, 8).map((s) => {
                const on = selectedSkills.includes(s.skill);
                return (
                  <button
                    key={s.skill}
                    type="button"
                    onClick={() => toggleSkill(s.skill)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition active:scale-95 ${
                      on
                        ? 'border-primary bg-primary text-white'
                        : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50'
                    }`}
                  >
                    {on && <Check className="mr-1 inline h-3 w-3" />}
                    {s.skill}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* === 不含项 (红色 X) === */}
      <section className="px-4 pb-2">
        <div className="rounded-2xl border-l-2 border-rose-300 bg-white p-4 shadow-warm-xs">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-serif-cn text-sm font-semibold text-rose-600">不含项 (不可加价)</span>
            <span className="font-cormorant italic text-[10px] tracking-wider text-rose-500">NOT INCLUDED</span>
          </div>
          <div className="space-y-2">
            {NOT_INCLUDED.map((i) => (
              <div key={i.name} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100">
                  <X className="h-3 w-3 text-rose-600" />
                </span>
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-rose-700">{i.name}</div>
                  <div className="text-[10px] text-ink-500">{i.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 rounded-xl bg-rose-50 p-2.5 text-[10px] leading-5 text-rose-700">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>服务内容已在订单中明确 · 加项以本页标价为准 · 任何额外索价可投诉</span>
          </div>
        </div>
      </section>

      {/* === 小费 === */}
      <section className="px-4 pb-2">
        <div className="rounded-2xl bg-white p-4 shadow-warm-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-serif-cn text-sm font-semibold text-ink-900">小费 (主动表达诚意)</span>
            <span className="font-cormorant italic text-[10px] tracking-wider text-warning-500">TIP</span>
          </div>
          <p className="mb-2.5 text-[10px] leading-5 text-ink-600">
            多给一点 · 她会优先来见你。<span className="font-semibold text-emerald-600">小费 ≠ 加钟</span>，是你主动事前给的诚意。
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {TIP_OPTIONS.map((v) => {
              const on = tip === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTip(v)}
                  className={`rounded-xl border py-2 text-[12px] transition active:scale-95 ${
                    on
                      ? 'border-warning-500 bg-warning-500/10 font-semibold text-warning-500'
                      : 'border-ink-100 bg-white text-ink-600'
                  }`}
                >
                  {v === 0 ? '无' : `+${v}`}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* === 心动金说明 === */}
      <section className="px-4 pb-2">
        <div className="flex gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/30 p-3">
          <Heart className="h-4 w-4 shrink-0 fill-emerald-500 text-emerald-500" />
          <div className="text-[10px] leading-5 text-ink-700">
            <span className="font-cormorant italic text-[9px] tracking-[0.3em] text-emerald-600">HEART DEPOSIT · 服务后退还</span>
            <div className="mt-0.5">预约成功冻结 · <span className="font-semibold text-emerald-600">服务完成自动退还</span> · 取消按规则扣</div>
          </div>
        </div>
      </section>

      {/* === 总价卡 === */}
      <section className="px-4 pt-3">
        <div className="rounded-2xl bg-gradient-to-br from-warm-50 to-rose-50 p-4 shadow-warm-sm">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-ink-600">基础服务 ({selectedDuration ?? '—'} 分钟)</span>
              <span className="num text-ink-900">{basePoints} pts</span>
            </div>
            {tip > 0 && (
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink-600">小费</span>
                <span className="num text-warning-500">+{tip} pts</span>
              </div>
            )}
            <div className="border-t border-warm-200/60 pt-2 flex items-baseline justify-between">
              <span className="text-serif-cn text-base font-semibold text-ink-900">应付总额</span>
              <div className="text-right">
                <span className="num font-display text-2xl font-bold text-primary">{totalPoints}</span>
                <span className="ml-1 text-[10px] text-ink-500">积分</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ErrorBanner message={error} />

      {/* === Sticky CTA === */}
      <div className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!priceOption || submitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98] disabled:opacity-50"
        >
          <Heart className="h-4 w-4 fill-white" />
          <span className="text-serif-cn text-sm font-medium tracking-wider">
            {submitting ? '锁定中…' : `锁定服务 · ${totalPoints} 积分`}
          </span>
          <ChevronRight className="h-4 w-4" />
        </button>
        <p className="mt-2 text-center text-[10px] leading-4 text-ink-500">
          点击即同意《服务协议》· 心动金<span className="font-semibold text-emerald-600">服务完成自动退还</span>
        </p>
      </div>
    </div>
  );
}
