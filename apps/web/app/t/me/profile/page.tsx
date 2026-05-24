'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PrimaryButton } from '@/components/ui';
import { apiGet, apiPut, ApiClientError } from '@/lib/api';

interface Profile {
  bio: string | null;
  nationality: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bustCm: number | null;
  hipCm: number | null;
  bodyFatPct: string | null;
  education: string | null;
  skillsJson: Array<{ skill: string; level: number }>;
  basePriceJson: Array<{ duration: number; pricePoints: number }>;
  profileCompleteness?: number;
}

export default function ProfileEditPage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<Profile>('/therapists/me');
        setP(data);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, []);

  function update<K extends keyof Profile>(k: K, v: Profile[K]) {
    if (!p) return;
    setP({ ...p, [k]: v });
  }

  async function save() {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        bio: p.bio,
        nationality: p.nationality,
        serviceCity: p.serviceCity,
        serviceArea: p.serviceArea,
        heightCm: p.heightCm,
        weightKg: p.weightKg,
        bustCm: p.bustCm,
        hipCm: p.hipCm,
        bodyFatPct: p.bodyFatPct ? Number(p.bodyFatPct) : undefined,
        education: p.education,
        skillsJson: p.skillsJson,
        basePriceJson: p.basePriceJson,
      };
      // 过滤 null/undefined（PUT 是部分更新）
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
      }
      const updated = await apiPut<Profile>('/therapists/me', cleaned);
      setP(updated);
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (!p) return <TherapistShell title="档案" showBack hideTabBar><LoadingFull /></TherapistShell>;

  return (
    <TherapistShell title="完善档案" showBack hideTabBar>
      <div className="space-y-5 px-5 py-5">
        <div className="rounded-2xl bg-ink-50 p-3 text-xs text-ink-700">
          完整度 {p.profileCompleteness ?? 0}% · 越完整越容易被推荐
        </div>

        <ErrorBanner message={error} />

        <Field label="自我介绍" hint="至少 20 字会更受欢迎">
          <textarea
            className="h-24 w-full rounded-xl border border-ink-100 p-3 text-sm"
            value={p.bio ?? ''}
            onChange={(e) => update('bio', e.target.value)}
          />
        </Field>

        <Field label="国籍">
          <input className="input-field" value={p.nationality ?? ''} onChange={(e) => update('nationality', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="服务城市">
            <input className="input-field" value={p.serviceCity ?? ''} onChange={(e) => update('serviceCity', e.target.value)} />
          </Field>
          <Field label="区域">
            <input className="input-field" value={p.serviceArea ?? ''} onChange={(e) => update('serviceArea', e.target.value)} />
          </Field>
        </div>

        <Section title="身体数据（仅平台用于匹配，绝不外露给客户）">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="身高 cm" value={p.heightCm} onChange={(v) => update('heightCm', v)} />
            <NumField label="体重 kg" value={p.weightKg} onChange={(v) => update('weightKg', v)} />
            <NumField label="胸围 cm" value={p.bustCm} onChange={(v) => update('bustCm', v)} />
            <NumField label="臀围 cm" value={p.hipCm} onChange={(v) => update('hipCm', v)} />
            <Field label="体脂率 %">
              <input
                className="input-field"
                type="number"
                step="0.1"
                value={p.bodyFatPct ?? ''}
                onChange={(e) => update('bodyFatPct', e.target.value || null)}
              />
            </Field>
            <Field label="学历">
              <input className="input-field" value={p.education ?? ''} onChange={(e) => update('education', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="服务价格（积分）">
          <div className="space-y-2">
            {p.basePriceJson.map((pr, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input-field"
                  type="number"
                  placeholder="分钟"
                  value={pr.duration}
                  onChange={(e) => {
                    const arr = [...p.basePriceJson];
                    arr[i] = { ...arr[i]!, duration: Number(e.target.value) };
                    update('basePriceJson', arr);
                  }}
                />
                <input
                  className="input-field"
                  type="number"
                  placeholder="积分"
                  value={pr.pricePoints}
                  onChange={(e) => {
                    const arr = [...p.basePriceJson];
                    arr[i] = { ...arr[i]!, pricePoints: Number(e.target.value) };
                    update('basePriceJson', arr);
                  }}
                />
                <button
                  type="button"
                  onClick={() => update('basePriceJson', p.basePriceJson.filter((_, j) => j !== i))}
                  className="text-xs text-primary"
                >
                  删
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update('basePriceJson', [...p.basePriceJson, { duration: 60, pricePoints: 100 }])}
              className="rounded-xl border border-ink-100 px-3 py-1.5 text-xs"
            >
              + 添加价格档
            </button>
          </div>
        </Section>

        {savedAt && <div className="text-xs text-success-500">已保存 · {savedAt.toLocaleTimeString()}</div>}

        <PrimaryButton onClick={() => void save()} loading={busy}>
          保存
        </PrimaryButton>
      </div>
    </TherapistShell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-700">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[10px] text-ink-500">{hint}</div>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Field label={label}>
      <input
        className="input-field"
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      />
    </Field>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
