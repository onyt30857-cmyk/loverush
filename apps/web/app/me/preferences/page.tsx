'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, PrimaryButton } from '@/components/ui';
import { apiPost, ApiClientError } from '@/lib/api';

const BODY_TYPES = [
  { v: '高挑', emoji: '✨' },
  { v: '丰满', emoji: '🌸' },
  { v: '苗条', emoji: '🌿' },
  { v: '健身', emoji: '💪' },
  { v: '可爱', emoji: '🍑' },
];

const STYLES = [
  { v: '温柔', emoji: '🌷' },
  { v: '调皮', emoji: '😈' },
  { v: '专业', emoji: '💼' },
  { v: '冷静', emoji: '🌙' },
  { v: '热情', emoji: '🔥' },
];

export default function PreferencesPage() {
  const [bodyTypes, setBodyTypes] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function toggle(set: string[], setSet: (s: string[]) => void, v: string) {
    setSet(set.includes(v) ? set.filter((x) => x !== v) : [...set, v]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const msg = `我的偏好：身材${bodyTypes.join('/') || '不限'}，风格${styles.join('/') || '不限'}，预算${budgetMin || '不限'}-${budgetMax || '不限'} 积分`;
      await apiPost('/assistant/chat', { message: msg });
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="我的偏好" showBack hideTabBar>
      <div className="bg-gradient-soft px-5 pb-3 pt-2 animate-fade-up">
        <div className="label-cormorant">YOUR PREFERENCES · 助理会按这个推荐</div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <ErrorBanner message={error} />

        {/* 身材偏好 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="mb-1 text-serif-cn text-sm font-semibold text-ink-800">身材偏好</div>
          <div className="label-cormorant mb-3">BODY TYPE · 多选</div>
          <div className="flex flex-wrap gap-2">
            {BODY_TYPES.map((b) => (
              <button
                key={b.v}
                type="button"
                onClick={() => toggle(bodyTypes, setBodyTypes, b.v)}
                className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition active:scale-95 ${
                  bodyTypes.includes(b.v)
                    ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                    : 'border-warm-100 bg-warm-50 text-ink-700'
                }`}
              >
                <span>{b.emoji}</span>
                {b.v}
              </button>
            ))}
          </div>
        </div>

        {/* 风格偏好 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="mb-1 text-serif-cn text-sm font-semibold text-ink-800">风格偏好</div>
          <div className="label-cormorant mb-3">VIBE · 多选</div>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <button
                key={s.v}
                type="button"
                onClick={() => toggle(styles, setStyles, s.v)}
                className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition active:scale-95 ${
                  styles.includes(s.v)
                    ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                    : 'border-warm-100 bg-warm-50 text-ink-700'
                }`}
              >
                <span>{s.emoji}</span>
                {s.v}
              </button>
            ))}
          </div>
        </div>

        {/* 预算 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="mb-1 text-serif-cn text-sm font-semibold text-ink-800">预算范围</div>
          <div className="label-cormorant mb-3">BUDGET · 积分</div>
          <div className="flex items-center gap-3">
            <input
              className="input-field"
              type="number"
              placeholder="最低"
              value={budgetMin}
              onChange={(e) => setBudgetMin(e.target.value)}
            />
            <span className="text-ink-300">—</span>
            <input
              className="input-field"
              type="number"
              placeholder="最高"
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
            />
          </div>
        </div>

        {savedAt && (
          <div className="rounded-xl bg-success-500/10 px-3 py-2 text-xs text-success-500">
            ✓ 已保存 · {savedAt.toLocaleTimeString()}
          </div>
        )}

        <PrimaryButton onClick={() => void save()} loading={busy}>
          保存偏好
        </PrimaryButton>

        <p className="text-center text-[11px] leading-6 text-ink-500">
          后续聊天中你说的偏好也会自动学习 · 助理会越来越懂你
        </p>
      </div>
    </AppShell>
  );
}
