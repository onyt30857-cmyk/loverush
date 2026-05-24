'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PointsTag, PrimaryButton } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface TherapistMini {
  id: string;
  displayName: string | null;
  basePriceJson?: Array<{ duration: number; pricePoints: number }>;
  skillsJson?: Array<{ skill: string; level: number }>;
}

export default function CreateOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<TherapistMini | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<TherapistMini>(`/therapists/${id}`);
        setT(data);
        const first = data.basePriceJson?.[0];
        if (first) setSelectedDuration(first.duration);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [id]);

  if (!t) {
    return (
      <AppShell title="下单" showBack hideTabBar>
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </AppShell>
    );
  }

  const priceOption = t.basePriceJson?.find((p) => p.duration === selectedDuration);

  function toggleSkill(s: string) {
    setSelectedSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submit() {
    if (!priceOption || !t) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await apiPost<{ id: string }>('/orders', {
        therapist_id: t.id,
        service_snapshot: {
          skills: selectedSkills,
          durationMin: priceOption.duration,
          pricePoints: priceOption.pricePoints,
        },
      });
      // 提交确认
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
    <AppShell title="下单 · 价格锁" showBack hideTabBar>
      <div className="px-5 py-5">
        <div className="text-sm text-ink-500">服务对象</div>
        <div className="mt-1 text-base font-semibold">{t.displayName ?? '技师'}</div>

        <div className="mt-6 text-sm font-semibold">选择时长</div>
        <div className="mt-2 space-y-2">
          {t.basePriceJson?.map((p) => (
            <button
              key={p.duration}
              type="button"
              onClick={() => setSelectedDuration(p.duration)}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm ${
                selectedDuration === p.duration ? 'border-primary bg-primary/5' : 'border-ink-100 bg-white'
              }`}
            >
              <span>{p.duration} 分钟</span>
              <PointsTag points={p.pricePoints} />
            </button>
          ))}
          {!t.basePriceJson?.length && <div className="text-xs text-ink-500">该技师未设置价格</div>}
        </div>

        {t.skillsJson && t.skillsJson.length > 0 && (
          <>
            <div className="mt-6 text-sm font-semibold">手法（多选）</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {t.skillsJson.map((s) => (
                <button
                  key={s.skill}
                  type="button"
                  onClick={() => toggleSkill(s.skill)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    selectedSkills.includes(s.skill)
                      ? 'border-primary bg-primary text-white'
                      : 'border-ink-100 bg-white text-ink-700'
                  }`}
                >
                  {s.skill}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-8 rounded-2xl border border-ink-100 bg-ink-50 p-4">
          <div className="text-xs text-ink-500">价格锁定后不再变动</div>
          <div className="mt-1 flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold text-primary">{priceOption?.pricePoints ?? 0}</div>
              <div className="text-xs text-ink-500">积分</div>
            </div>
            <div className="text-xs text-ink-500">
              ≈ ${((priceOption?.pricePoints ?? 0) / 100).toFixed(2)}
            </div>
          </div>
        </div>

        <ErrorBanner message={error} />

        <div className="mt-6">
          <PrimaryButton onClick={() => void submit()} loading={submitting} disabled={!priceOption}>
            确认下单 · 提交给技师确认
          </PrimaryButton>
        </div>
      </div>
    </AppShell>
  );
}
