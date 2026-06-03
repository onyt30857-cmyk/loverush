'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PrimaryButton } from '@/components/ui';
import { apiGet, apiPatch, apiPut, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Preferences {
  preferredCustomerTypes?: string[];
  rejectedCustomerTypes?: string[];
  acceptableBehaviors?: string[];
  unacceptableBehaviors?: string[];
}

interface BasePriceEntry {
  duration: number;
  pricePoints: number;
  // 0027 法币模式 · 老订单为 undefined
  currencyCode?: string;
  priceFiat?: number;
}

interface CurrencyDto {
  code: string;
  symbol: string;
  nameZh: string;
  decimals: number;
  pointsPerUnit: string | null;
}

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
  basePriceJson: BasePriceEntry[];
  preferencesJson: Preferences | null;
  profileCompleteness?: number;
}

const PRESET_PREFERRED = ['30+ 男士', '商务客', '熟客', '安静聊天', '活泼互动', '文化人'];
const PRESET_REJECTED = ['酒后客', '无礼客', '过度紧张初次客'];
const PRESET_ACCEPTABLE = ['拥抱', '简单聊天', '拍合照', '深度按摩', '轻度调情'];
const PRESET_UNACCEPTABLE = ['触摸下身', '私密服务', '加钟诱导', '过度肢体接触'];

export default function ProfileEditPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  // 展示昵称(users.display_name)· 单独维护 · 保存时走 PATCH /me
  const [displayName, setDisplayName] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);

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

  // 0027 · 拉公开 currencies(失败静默)
  useEffect(() => {
    void (async () => {
      try {
        const list = await apiGet<CurrencyDto[]>('/currencies');
        setCurrencies(list);
      } catch {
        /* 静默 */
      }
    })();
  }, []);

  // 初始 displayName 从 useAuth 拿(已被 /me 接口返回)
  useEffect(() => {
    if (user?.displayName !== undefined && user.displayName !== null) {
      setDisplayName(user.displayName);
    }
  }, [user?.displayName]);

  function update<K extends keyof Profile>(k: K, v: Profile[K]) {
    if (!p) return;
    setP({ ...p, [k]: v });
  }

  async function save() {
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      // 1) 展示昵称单独走 PATCH /me · 校验 2-20 字(技师严)
      const dn = displayName.trim();
      if (dn.length === 0) {
        setError('展示昵称不能为空');
        setBusy(false);
        return;
      }
      if (dn.length < 2 || dn.length > 20) {
        setError('展示昵称 2-20 字');
        setBusy(false);
        return;
      }
      if (dn !== (user?.displayName ?? '')) {
        await apiPatch('/me', { display_name: dn });
        await refresh();
      }

      // 2) 档案其他字段走 PUT /therapists/me
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
        preferencesJson: p.preferencesJson ?? undefined,
      };
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
      {/* M1.T · 整页 bg-gradient-soft 消除原本表单底部到导航之间的暖→白硬切 */}
      <div className="min-h-full space-y-5 bg-gradient-soft px-5 py-5">
        <div className="rounded-2xl bg-ink-50 p-3 text-xs text-ink-700">
          完整度 {p.profileCompleteness ?? 0}% · 越完整越容易被推荐
        </div>

        <ErrorBanner message={error} />

        <Field label="展示昵称" hint="客户看到的名字 · 2-20 字 · 建议简洁好记(例:小柔、Mimi、阿雅)">
          <input
            className="input-field"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
            maxLength={20}
            placeholder="例:小柔 / Mimi"
          />
        </Field>

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

        <Section title="基础数据" subtitle="会显示在你的公开档案">
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

        <Section title="风格 & 边界" subtitle="让对的客户更容易找到你 · 也帮你避开不想接的人">
          <PrefChips
            label="她喜欢的客户类型"
            presets={PRESET_PREFERRED}
            value={p.preferencesJson?.preferredCustomerTypes ?? []}
            onChange={(arr) => update('preferencesJson', { ...(p.preferencesJson ?? {}), preferredCustomerTypes: arr })}
          />
          <PrefChips
            label="她不接的客户类型"
            presets={PRESET_REJECTED}
            value={p.preferencesJson?.rejectedCustomerTypes ?? []}
            onChange={(arr) => update('preferencesJson', { ...(p.preferencesJson ?? {}), rejectedCustomerTypes: arr })}
          />
          <PrefChips
            label="可接受的行为 (WELCOME)"
            presets={PRESET_ACCEPTABLE}
            value={p.preferencesJson?.acceptableBehaviors ?? []}
            onChange={(arr) => update('preferencesJson', { ...(p.preferencesJson ?? {}), acceptableBehaviors: arr })}
            tone="welcome"
          />
          <PrefChips
            label="不可接受的行为 (NO WAY)"
            presets={PRESET_UNACCEPTABLE}
            value={p.preferencesJson?.unacceptableBehaviors ?? []}
            onChange={(arr) => update('preferencesJson', { ...(p.preferencesJson ?? {}), unacceptableBehaviors: arr })}
            tone="noway"
          />
        </Section>

        <Section title="服务价格（按法币定价）">
          <div className="space-y-2">
            <div className="rounded-xl bg-ink-50 px-3 py-2 text-[10.5px] leading-5 text-ink-600">
              客户线下面付 · 平台只冻结心动金(10% 等值积分)· 心动金服务后自动退还
            </div>
            {p.basePriceJson.map((pr, i) => {
              const cur = currencies.find((c) => c.code === pr.currencyCode);
              const rate = cur?.pointsPerUnit ? parseFloat(cur.pointsPerUnit) : null;
              const fiat = pr.priceFiat ?? 0;
              const estPoints = rate ? Math.ceil(fiat * rate) : pr.pricePoints;
              const estDeposit = Math.ceil(estPoints * 0.1);
              return (
                <div key={i} className="rounded-xl border border-ink-100 p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="input-field w-20"
                      type="number"
                      placeholder="分钟"
                      value={pr.duration}
                      onChange={(e) => {
                        const arr = [...p.basePriceJson];
                        arr[i] = { ...arr[i]!, duration: Number(e.target.value) };
                        update('basePriceJson', arr);
                      }}
                    />
                    <span className="text-[10px] text-ink-500">分钟</span>
                    <button
                      type="button"
                      onClick={() => update('basePriceJson', p.basePriceJson.filter((_, j) => j !== i))}
                      className="ml-auto text-[11px] text-primary"
                    >
                      删
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="input-field w-24"
                      value={pr.currencyCode ?? (currencies[0]?.code ?? '')}
                      onChange={(e) => {
                        const arr = [...p.basePriceJson];
                        arr[i] = { ...arr[i]!, currencyCode: e.target.value };
                        update('basePriceJson', arr);
                      }}
                    >
                      {currencies.length === 0 && <option value="">—</option>}
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                      ))}
                    </select>
                    <input
                      className="input-field flex-1"
                      type="number"
                      placeholder="价格"
                      value={pr.priceFiat ?? ''}
                      step={cur?.decimals === 0 ? 1 : 0.01}
                      min={0}
                      onChange={(e) => {
                        const arr = [...p.basePriceJson];
                        arr[i] = { ...arr[i]!, priceFiat: Number(e.target.value) };
                        update('basePriceJson', arr);
                      }}
                    />
                  </div>
                  {cur && rate && fiat > 0 && (
                    <div className="rounded-lg bg-primary/5 px-2 py-1.5 text-[10.5px] text-ink-600">
                      客户线下面付 <span className="font-semibold text-primary">{cur.symbol}{fiat.toLocaleString('en-US', { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })}</span>
                      <span className="ml-1 text-ink-400">· 心动金 ~{cur.symbol}{(fiat * 0.1).toLocaleString('en-US', { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })}(10%)</span>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => update('basePriceJson', [...p.basePriceJson, {
                duration: 60,
                pricePoints: 0,
                currencyCode: currencies[0]?.code,
                priceFiat: 1500,
              }])}
              className="rounded-xl border border-dashed border-ink-200 w-full py-2 text-[12px] text-ink-600 active:bg-ink-50"
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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
      <div>
        <div className="text-sm font-semibold text-ink-900">{title}</div>
        {subtitle && <div className="mt-0.5 text-[11px] text-ink-500">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function PrefChips({
  label,
  presets,
  value,
  onChange,
  tone,
}: {
  label: string;
  presets: string[];
  value: string[];
  onChange: (arr: string[]) => void;
  tone?: 'welcome' | 'noway';
}) {
  function toggle(s: string) {
    onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  }
  const activeClass =
    tone === 'noway'
      ? 'border-rose-300 bg-rose-50 text-rose-600'
      : tone === 'welcome'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : 'border-primary bg-primary/10 text-primary';
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-ink-700">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((s) => {
          const on = value.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition active:scale-95 ${
                on ? activeClass : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
