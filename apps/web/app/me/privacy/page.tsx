'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PrimaryButton } from '@/components/ui';
import { apiDelete, apiGet, apiPost, apiPut, ApiClientError } from '@/lib/api';

interface PrivacyState {
  hasPin: boolean;
  privacyModeEnabled: number;
  decoyEnabled: number;
  decoyType: string;
  autoLockSeconds: number;
  obfuscateNotifications: number;
}

export default function PrivacyPage() {
  const [state, setState] = useState<PrivacyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState<'set' | 'change' | 'clear' | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const data = await apiGet<PrivacyState>('/privacy');
      setState(data);
    } catch (err) {
      // 失败必设 error，让 loading 守卫显示错误态而非永久白屏
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(field: string, value: boolean) {
    try {
      const data = await apiPut<PrivacyState>('/privacy', { [field]: value });
      setState(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function setAutoLock(seconds: number) {
    try {
      const data = await apiPut<PrivacyState>('/privacy', { auto_lock_seconds: seconds });
      setState(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function submitPin() {
    setBusy(true);
    setError(null);
    try {
      if (pinMode === 'set') {
        await apiPost('/privacy/pin', { new_pin: pinInput });
      } else if (pinMode === 'change') {
        await apiPost('/privacy/pin', { new_pin: pinInput, current_pin: currentPin });
      } else if (pinMode === 'clear') {
        await apiDelete('/privacy/pin', { current_pin: currentPin });
      }
      setPinMode(null);
      setPinInput('');
      setCurrentPin('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <AppShell title="隐私模式" showBack hideTabBar>
        {error ? <ErrorBanner message={error} /> : <LoadingFull />}
      </AppShell>
    );
  }

  return (
    <AppShell title="隐私模式" showBack hideTabBar>
      <div className="bg-gradient-soft px-5 pb-3 pt-2 animate-fade-up">
        <div className="gradient-orb h-12 w-12 text-xl">🔒</div>
        <div className="label-cormorant mt-3">PRIVACY MODE · 双重保护</div>
        <p className="mt-2 text-[12px] leading-7 text-ink-600">
          开启后将启用 PIN 锁屏 / 通知模糊化 / 自动锁回。
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        <ErrorBanner message={error} />

        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-serif-cn text-sm font-semibold text-ink-800">总开关</div>
              <div className="mt-0.5 text-[11px] text-ink-600">启用后部分场景隐藏敏感内容</div>
            </div>
            <input
              type="checkbox"
              checked={state.privacyModeEnabled === 1}
              onChange={(e) => void toggle('privacy_mode_enabled', e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="text-serif-cn text-sm font-semibold text-ink-800">PIN 密码</div>
          <div className="mt-0.5 text-xs text-ink-500">
            {state.hasPin ? '✓ 已设置（4-8 位数字）' : '未设置'}
          </div>
          {!pinMode && (
            <div className="mt-3 flex gap-2">
              {!state.hasPin && (
                <button
                  type="button"
                  onClick={() => setPinMode('set')}
                  className="rounded-xl bg-primary px-3 py-1.5 text-xs text-white"
                >
                  设置 PIN
                </button>
              )}
              {state.hasPin && (
                <>
                  <button
                    type="button"
                    onClick={() => setPinMode('change')}
                    className="rounded-xl bg-primary px-3 py-1.5 text-xs text-white"
                  >
                    修改 PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinMode('clear')}
                    className="rounded-xl border border-ink-100 px-3 py-1.5 text-xs text-ink-700"
                  >
                    清除 PIN
                  </button>
                </>
              )}
            </div>
          )}
          {pinMode && (
            <div className="mt-3 space-y-2">
              {(pinMode === 'change' || pinMode === 'clear') && (
                <input
                  className="input-field"
                  type="password"
                  inputMode="numeric"
                  placeholder="当前 PIN（4-8 位）"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  maxLength={8}
                />
              )}
              {pinMode !== 'clear' && (
                <input
                  className="input-field"
                  type="password"
                  inputMode="numeric"
                  placeholder="新 PIN（4-8 位）"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  maxLength={8}
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPinMode(null);
                    setPinInput('');
                    setCurrentPin('');
                  }}
                  className="flex-1 rounded-xl border border-ink-100 py-2 text-sm"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void submitPin()}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-primary py-2 text-sm text-white disabled:opacity-50"
                >
                  {busy ? '处理中…' : '确认'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="text-serif-cn text-sm font-semibold text-ink-800">自动锁回</div>
          <div className="mt-0.5 text-[11px] text-ink-600">无操作多久后锁屏</div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[60, 300, 600, 1800].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void setAutoLock(s)}
                className={`rounded-xl border py-2 text-xs transition active:scale-95 ${
                  state.autoLockSeconds === s
                    ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                    : 'border-warm-100 bg-warm-50 text-ink-700'
                }`}
              >
                {s < 60 ? `${s}s` : `${Math.floor(s / 60)}min`}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-serif-cn text-sm font-semibold text-ink-800">通知模糊化</div>
              <div className="mt-0.5 text-[11px] text-ink-600">推送只显示「新消息」，不显示内容</div>
            </div>
            <input
              type="checkbox"
              checked={state.obfuscateNotifications === 1}
              onChange={(e) => void toggle('obfuscate_notifications', e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
