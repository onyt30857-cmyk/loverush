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

const NICK_PRESETS = ['哥哥', '帅哥', '宝', '直接喊名字'];

export default function AiAlterPage() {
  const [enabled, setEnabled] = useState(true);

  // —— 核心人设（对话式，自由文本优先）——
  const [selfDescription, setSelfDescription] = useState('');
  const [speechSample, setSpeechSample] = useState('');
  const [nicknameForCustomer, setNicknameForCustomer] = useState('');

  // —— 高级微调（大致风格，不填也行）——
  const [tone, setTone] = useState('温柔');
  const [warmth, setWarmth] = useState(70);
  const [proactivity, setProactivity] = useState(50);
  const [humor, setHumor] = useState(30);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/therapists/me/ai-alter/configure', {
        enabled,
        personality: {
          tone,
          warmth,
          proactivity,
          humor,
          selfDescription: selfDescription.trim() || undefined,
          speechSample: speechSample.trim() || undefined,
          nicknameForCustomer: nicknameForCustomer.trim() || undefined,
        },
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
              你离线超过 5 分钟时，按下面的"你"代你回客户、维系老客。
              <br />
              <strong className="text-ink-800">客户看不出这是分身</strong>，你随时能看到它说了什么、也能随时关掉。
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

        {/* ───────── 核心人设：让它"像你" ───────── */}
        <div className="rounded-2xl border border-primary/30 bg-gradient-soft p-4 shadow-warm-xs">
          <div className="text-serif-cn text-sm font-semibold text-ink-800">先让它「像你」</div>
          <div className="label-cormorant mb-2 mt-0.5">WHO YOU ARE</div>
          <p className="mb-3 text-[11px] leading-5 text-ink-600">
            像跟朋友介绍自己那样填，越像你、越有脾气，客户越上头。空着也能用，但就没那么像你了。
          </p>

          <TextAreaField
            label="你是个什么样的女孩？"
            hint="性格、说话习惯、还有——你的脾气和底线（这点最重要，别只写温柔）"
            placeholder="例：我性子有点野，爱开玩笑，但你敷衍我我就懒得理你。高兴了会撒娇，惹毛了能冷你好几天。不接喝多酒的，也不许动手动脚。"
            value={selfDescription}
            onChange={setSelfDescription}
            rows={4}
            max={1500}
          />

          <div className="h-3" />

          <TextAreaField
            label="你平时怎么跟熟客聊？"
            hint="贴一两句你真会说的话，让它学你的口气（它会模仿语气，不照抄）"
            placeholder="例：哎哟稀客～这么久才想起人家💢 / 累死了今天，你呢？ / 想我就直说嘛，绕什么弯子"
            value={speechSample}
            onChange={setSpeechSample}
            rows={3}
            max={800}
          />

          <div className="h-3" />

          {/* 称呼 */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-serif-cn text-sm font-semibold text-ink-800">你习惯怎么叫客户？</span>
            </div>
            <div className="mb-2 mt-1 flex flex-wrap gap-2">
              {NICK_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNicknameForCustomer(n === '直接喊名字' ? '' : n)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition active:scale-95 ${
                    nicknameForCustomer === n
                      ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                      : 'border-warm-100 bg-warm-50 text-ink-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={nicknameForCustomer}
              onChange={(e) => setNicknameForCustomer(e.target.value)}
              maxLength={20}
              placeholder="或自己输入，比如：亲、老板、宝贝"
              className="w-full rounded-xl border border-warm-100 bg-white px-3 py-2 text-sm text-ink-800 outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* ───────── 高级微调：大致风格 ───────── */}
        <div className="rounded-2xl border border-warm-100 bg-white shadow-warm-xs">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between p-4"
          >
            <div className="text-left">
              <div className="text-serif-cn text-sm font-semibold text-ink-800">高级：大致风格微调</div>
              <div className="mt-0.5 text-[11px] text-ink-600">上面填了就够了，这里可不动</div>
            </div>
            <span className="text-ink-500">{advancedOpen ? '收起' : '展开'}</span>
          </button>

          {advancedOpen && (
            <div className="space-y-4 px-4 pb-4">
              <div>
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
              <SliderField label="主动性" en="PROACTIVITY" hint="越大越主动找话题" value={proactivity} onChange={setProactivity} />
              <SliderField label="幽默" en="HUMOR" hint="越大越爱开玩笑" value={humor} onChange={setHumor} />
            </div>
          )}
        </div>

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

function TextAreaField({
  label,
  hint,
  placeholder,
  value,
  onChange,
  rows,
  max,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  max: number;
}) {
  return (
    <div>
      <div className="text-serif-cn text-sm font-semibold text-ink-800">{label}</div>
      {hint && <div className="mb-2 mt-0.5 text-[11px] leading-4 text-ink-600">{hint}</div>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-warm-100 bg-white px-3 py-2 text-sm leading-6 text-ink-800 outline-none focus:border-primary"
      />
      <div className="mt-0.5 text-right text-[10px] text-ink-500">
        {value.length}/{max}
      </div>
    </div>
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
