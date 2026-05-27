'use client';

import { useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, GradientOrb, PrimaryButton } from '@/components/ui';
import { apiPost, ApiClientError } from '@/lib/api';

const TONES = [
  { v: '温柔', emoji: '🌷' },
  { v: '直接', emoji: '🎯' },
  { v: '调皮', emoji: '😈' },
  { v: '冷静', emoji: '🌙' },
  { v: '热情', emoji: '🔥' },
];

export default function AiAlterPage() {
  const [enabled, setEnabled] = useState(true);
  const [tone, setTone] = useState('温柔');
  const [warmth, setWarmth] = useState(70);
  const [proactivity, setProactivity] = useState(50);
  const [humor, setHumor] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/therapists/me/ai-alter/configure', {
        enabled,
        personality: { tone, warmth, proactivity, humor },
      });
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TherapistShell>
      <div className="bg-gradient-soft px-5 pb-3 pt-4 animate-fade-up">
        <div className="flex items-start gap-3">
          <GradientOrb size={44} icon="✨" />
          <div className="flex-1">
            <div className="text-serif-cn text-base font-bold text-ink-800">代你回客户</div>
            <div className="label-cormorant mt-1">YOUR DOUBLE</div>
            <p className="mt-2 text-[12px] leading-6 text-ink-600">
              离线超过 5 分钟时，按你的风格代你回复 · 保持客户黏性。
              <br />
              <strong className="text-ink-800">客户看不到这是分身</strong>。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        <ErrorBanner message={error} />

        {/* 启用开关 */}
        <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div>
            <div className="text-serif-cn text-sm font-semibold text-ink-800">启用分身</div>
            <div className="mt-0.5 text-[11px] text-ink-600">关闭后离线消息无回复</div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 accent-primary"
          />
        </label>

        {/* 语气 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="text-serif-cn text-sm font-semibold text-ink-800">语气</div>
          <div className="label-cormorant mb-3 mt-0.5">TONE</div>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setTone(t.v)}
                className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition active:scale-95 ${
                  tone === t.v
                    ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                    : 'border-warm-100 bg-warm-50 text-ink-700'
                }`}
              >
                <span>{t.emoji}</span>
                {t.v}
              </button>
            ))}
          </div>
        </div>

        <SliderField label="温度" en="WARMTH" hint="越大越亲密" value={warmth} onChange={setWarmth} />
        <SliderField label="主动性" en="PROACTIVITY" hint="越大越主动引导话题" value={proactivity} onChange={setProactivity} />
        <SliderField label="幽默" en="HUMOR" hint="越大越爱开玩笑" value={humor} onChange={setHumor} />

        {savedAt && (
          <div className="rounded-xl bg-success-500/10 px-3 py-2 text-xs text-success-500">
            ✓ 已保存 · {savedAt.toLocaleTimeString()}
          </div>
        )}

        <PrimaryButton onClick={() => void save()} loading={busy}>
          保存设置
        </PrimaryButton>
      </div>
    </TherapistShell>
  );
}

function SliderField({
  label,
  en,
  hint,
  value,
  onChange,
}: {
  label: string;
  en: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-serif-cn text-sm font-semibold text-ink-800">{label}</span>
          <span className="label-cormorant ml-2">{en}</span>
        </div>
        <span className="text-display text-xl font-bold text-primary num">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full accent-primary"
      />
      {hint && <div className="mt-1 text-[10px] text-ink-600">{hint}</div>}
    </div>
  );
}
