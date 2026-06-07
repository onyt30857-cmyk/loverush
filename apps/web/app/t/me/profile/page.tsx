'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TherapistShell } from '@/components/AppShell';
import { Avatar, ErrorBanner, LoadingFull, PrimaryButton } from '@/components/ui';
import { apiGet, apiPatch, apiPut, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCountries, useCities, useAreas } from '@/lib/location';
import { MediaUploader } from '@/components/upload/MediaUploader';
import type { MediaAsset } from '@/lib/upload';

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
  avatarUrl: string | null;
  bio: string | null;
  nationality: string | null;
  serviceCountry: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  serviceCityId: string | null;
  serviceAreaId: string | null;
  serviceMode: 'outcall' | 'incall' | 'both';
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
  // 到店服务门店信息(serviceMode incall/both 才填)· 后端回显
  serviceAddressFull?: string | null;
  shopArrivalNote?: string | null;
  shopGuideMedia?: ShopGuideMediaEntry[] | null;
}

// shopGuideMedia 入库结构(contract):mediaId + kind + 可选 caption
// previewUrl 仅前端本地预览用(回显时由后端某 url 或本地上传 publicUrl 填),不入库
interface ShopGuideMediaEntry {
  mediaId: string;
  kind: 'image' | 'video';
  caption?: string;
  previewUrl?: string;
}

const PRESET_PREFERRED = ['30+ 男士', '商务客', '熟客', '安静聊天', '活泼互动', '文化人'];
const PRESET_REJECTED = ['酒后客', '无礼客', '过度紧张初次客'];
const PRESET_ACCEPTABLE = ['拥抱', '简单聊天', '拍合照', '深度按摩', '轻度调情'];
const PRESET_UNACCEPTABLE = ['触摸下身', '私密服务', '加钟诱导', '过度肢体接触'];

// 国籍下拉选项(东南亚 O2O + 东亚常见)· 收敛防脏数据,无字典走前端常量
const NATIONALITY_OPTIONS = [
  '泰国', '中国', '新加坡', '马来西亚', '越南', '印度尼西亚', '菲律宾',
  '日本', '韩国', '中国台湾', '中国香港', '缅甸', '柬埔寨', '老挝', '其他',
];

// 风控红线:WELCOME/喜欢类的自定义内容不得涉性/招揽违规(escort 合规线)· 前后端双拦
const RED_LINE_RE = /性|做爱|上床|开房|约炮|援交|一条龙|全套|口|裸|嫖|特殊服务|私密服务|sex|fuck|escort/i;

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

  // 地理字典 · 所在国家 → 城市 → 区域 三级级联
  const { countries } = useCountries();
  // 当前所在国家(ISO code)· 派生自 serviceCountry,选了才按国筛城市
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const { cities } = useCities(countryCode ?? undefined);
  const { areas } = useAreas(p?.serviceCityId ?? null);

  // 回显所在国家:serviceCountry(支持 code/中文) 直配;旧数据无国家则按城市反推
  useEffect(() => {
    if (!p || countryCode) return;
    if (p.serviceCountry && countries.length) {
      const m = countries.find((c) => c.country === p.serviceCountry || c.label === p.serviceCountry);
      if (m) {
        setCountryCode(m.country);
        if (p.serviceCountry !== m.country) setP((prev) => (prev ? { ...prev, serviceCountry: m.country } : prev));
        return;
      }
    }
    if (!p.serviceCountry && p.serviceCity && cities.length) {
      const city = cities.find((c) => c.id === p.serviceCityId || c.name === p.serviceCity);
      if (city) {
        setCountryCode(city.country);
        setP((prev) => (prev ? { ...prev, serviceCountry: city.country } : prev));
      }
    }
  }, [p, countries, cities, countryCode]);

  // 选国家:写 serviceCountry(code),清空城市/区域(换国重选)
  function pickCountry(code: string) {
    if (!p) return;
    setCountryCode(code || null);
    setP({ ...p, serviceCountry: code || null, serviceCity: null, serviceCityId: null, serviceArea: null, serviceAreaId: null });
  }

  // 旧数据回显:只有 name 没有 id 时,按 name 在字典里反查预选(不丢已填)
  useEffect(() => {
    if (!p || p.serviceCityId || !p.serviceCity || cities.length === 0) return;
    const m = cities.find((c) => c.name === p.serviceCity);
    if (m) setP((prev) => (prev ? { ...prev, serviceCityId: m.id } : prev));
  }, [cities, p?.serviceCity, p?.serviceCityId]);
  useEffect(() => {
    if (!p || p.serviceAreaId || !p.serviceArea || areas.length === 0) return;
    const m = areas.find((a) => a.name === p.serviceArea);
    if (m) setP((prev) => (prev ? { ...prev, serviceAreaId: m.id } : prev));
  }, [areas, p?.serviceArea, p?.serviceAreaId]);

  function update<K extends keyof Profile>(k: K, v: Profile[K]) {
    if (!p) return;
    setP({ ...p, [k]: v });
  }

  // 选城市:写 id + name 镜像,清空区域
  function pickCity(id: string) {
    if (!p) return;
    const c = cities.find((x) => x.id === id);
    setP({ ...p, serviceCityId: id || null, serviceCity: c?.name ?? null, serviceAreaId: null, serviceArea: null });
  }
  function pickArea(id: string) {
    if (!p) return;
    const a = areas.find((x) => x.id === id);
    setP({ ...p, serviceAreaId: id || null, serviceArea: a?.name ?? null });
  }

  // 找店指引媒体 · 上传完成追加(mediaId + kind + 本地预览 url)
  function addShopMedia(asset: MediaAsset) {
    if (!p) return;
    const kind: 'image' | 'video' = (asset.mimeType ?? '').startsWith('video/') ? 'video' : 'image';
    const entry: ShopGuideMediaEntry = {
      mediaId: asset.id,
      kind,
      previewUrl: asset.thumbnailUrl ?? asset.publicUrl ?? undefined,
    };
    update('shopGuideMedia', [...(p.shopGuideMedia ?? []), entry]);
  }
  function removeShopMedia(i: number) {
    if (!p) return;
    update('shopGuideMedia', (p.shopGuideMedia ?? []).filter((_, j) => j !== i));
  }
  function setShopMediaCaption(i: number, caption: string) {
    if (!p) return;
    const arr = [...(p.shopGuideMedia ?? [])];
    if (arr[i]) arr[i] = { ...arr[i]!, caption };
    update('shopGuideMedia', arr);
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
        avatarUrl: p.avatarUrl,
        bio: p.bio,
        nationality: p.nationality,
        serviceCountry: p.serviceCountry,
        serviceCity: p.serviceCity,
        serviceArea: p.serviceArea,
        serviceCityId: p.serviceCityId ?? undefined,
        serviceAreaId: p.serviceAreaId ?? undefined,
        serviceMode: p.serviceMode,
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

      // 到店门店信息 · 仅 incall/both 才发;outcall 显式发空清掉历史
      // 这几个字段允许发空字符串/空数组(用于清空),不能被上面的 cleaned 过滤
      if (p.serviceMode !== 'outcall') {
        cleaned.serviceAddressFull = (p.serviceAddressFull ?? '').trim();
        cleaned.shopArrivalNote = (p.shopArrivalNote ?? '').trim();
        cleaned.shopGuideMedia = (p.shopGuideMedia ?? []).map((m) => ({
          mediaId: m.mediaId,
          kind: m.kind,
          ...(m.caption?.trim() ? { caption: m.caption.trim() } : {}),
        }));
      } else {
        cleaned.serviceAddressFull = '';
        cleaned.shopArrivalNote = '';
        cleaned.shopGuideMedia = [];
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

        {/* 头像 · 点击更换(选图→上传→存 avatarUrl,保存时随档案一起 PUT) */}
        <div className="flex flex-col items-center pt-1">
          <MediaUploader
            purpose="avatar"
            basePath="/therapists/me"
            onComplete={(asset) => {
              if (asset.publicUrl) update('avatarUrl', asset.publicUrl);
            }}
          >
            <div className="relative">
              <Avatar size={88} src={p.avatarUrl ?? undefined} fallback={displayName ? displayName.slice(0, 1) : '我'} />
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-[13px] text-white shadow-warm-sm">
                ✎
              </span>
            </div>
          </MediaUploader>
          <div className="mt-2 text-[12px] text-ink-500">点击更换头像 · JPG/PNG ≤5MB</div>
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
          <select className="input-field" value={p.nationality ?? ''} onChange={(e) => update('nationality', e.target.value || null)}>
            <option value="">请选择</option>
            {p.nationality && !NATIONALITY_OPTIONS.includes(p.nationality) && (
              <option value={p.nationality}>{p.nationality}（当前）</option>
            )}
            {NATIONALITY_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>

        <Field label="所在国家" hint="你在哪个国家工作 · 与国籍无关">
          <select className="input-field" value={countryCode ?? ''} onChange={(e) => pickCountry(e.target.value)}>
            <option value="">请选择国家</option>
            {countries.map((c) => (
              <option key={c.country} value={c.country}>{c.flag} {c.label}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="服务城市">
            <select className="input-field" value={p.serviceCityId ?? ''} onChange={(e) => pickCity(e.target.value)} disabled={!countryCode}>
              <option value="">{countryCode ? '请选择城市' : '先选国家'}</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="区域">
            <select className="input-field" value={p.serviceAreaId ?? ''} onChange={(e) => pickArea(e.target.value)} disabled={!p.serviceCityId}>
              <option value="">{p.serviceCityId ? '请选择区域' : '先选城市'}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="服务方式">
          <div className="flex gap-2">
            {(
              [
                ['outcall', '上门'],
                ['incall', '到店'],
                ['both', '两者'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => update('serviceMode', v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                  (p.serviceMode ?? 'outcall') === v
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-warm-200 text-ink-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            {(p.serviceMode ?? 'outcall') === 'incall'
              ? '客户到你这边（店/工作室），地址下单后展示给客户'
              : (p.serviceMode ?? 'outcall') === 'both'
                ? '上门、到店都接，客户下单时选'
                : '你上门到客户那里服务'}
          </p>
        </Field>

        {/* 到店门店信息 · serviceMode incall/both 才展开(outcall 隐藏) */}
        {(p.serviceMode ?? 'outcall') !== 'outcall' && (
          <Section
            title="到店门店信息"
            subtitle="客户确认订单后才看得到 · 帮她顺利找到你"
          >
            <Field label="门店完整地址" hint="越具体越好 · 写到门牌/楼层(下单确认后才展示给客户)">
              <textarea
                className="h-20 w-full rounded-xl border border-ink-100 p-3 text-sm"
                value={p.serviceAddressFull ?? ''}
                onChange={(e) => update('serviceAddressFull', e.target.value)}
                placeholder="例:上海市黄浦区 XX 路 88 号 XX 大厦 12 楼 1203 室"
              />
            </Field>

            <Field label="到店须知" hint="到了之后怎么找到你">
              <textarea
                className="h-20 w-full rounded-xl border border-ink-100 p-3 text-sm"
                value={p.shopArrivalNote ?? ''}
                onChange={(e) => update('shopArrivalNote', e.target.value)}
                placeholder="如:按门铃说预约的 / 到门口发消息给我"
              />
            </Field>

            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-700">找店指引图 / 视频</div>
              <div className="mb-2 text-[10px] text-ink-500">
                可选 · 拍门口/门牌/电梯/楼层指引 · 客户照着走不迷路(图最大 20MB · 视频最大 50MB)
              </div>

              {(p.shopGuideMedia?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  {(p.shopGuideMedia ?? []).map((m, i) => (
                    <div key={`${m.mediaId}-${i}`} className="flex gap-2 rounded-xl border border-ink-100 p-2">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                        {m.previewUrl ? (
                          m.kind === 'video' ? (
                            <div className="flex h-full w-full items-center justify-center bg-ink-800 text-white">▶</div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.previewUrl} alt="" className="h-full w-full object-cover" />
                          )
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-400">
                            {m.kind === 'video' ? '视频' : '图'}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col justify-between">
                        <input
                          className="input-field text-[12px]"
                          value={m.caption ?? ''}
                          onChange={(e) => setShopMediaCaption(i, e.target.value)}
                          placeholder="说明(可选)· 如:从这个门进"
                        />
                        <button
                          type="button"
                          onClick={() => removeShopMedia(i)}
                          className="mt-1 self-start text-[11px] text-primary active:opacity-70"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-4 text-center text-[11.5px] text-ink-500">
                  还没传找店指引 · 一张门口照能帮客户少走很多冤枉路
                </div>
              )}

              <MediaUploader purpose="shop_guide" onComplete={addShopMedia} className="mt-2">
                <button
                  type="button"
                  className="w-full rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
                >
                  + 上传找店指引图/视频
                </button>
              </MediaUploader>
            </div>
          </Section>
        )}

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
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // 可接受行为(WELCOME)的自定义须过红线(防把违规内容写成卖点);其余放开
  const guard = tone === 'welcome';

  function toggle(s: string) {
    onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  }
  function remove(s: string) {
    onChange(value.filter((x) => x !== s));
  }
  function addCustom() {
    const v = draft.trim();
    setErr(null);
    if (!v) return;
    if (v.length > 12) return setErr('每个标签最多 12 字');
    if (value.length >= 12) return setErr('最多 12 个');
    if (value.includes(v) || presets.includes(v)) return setDraft('');
    if (guard && RED_LINE_RE.test(v)) return setErr('涉及平台红线,不能添加这条');
    onChange([...value, v]);
    setDraft('');
  }

  const activeClass =
    tone === 'noway'
      ? 'border-rose-300 bg-rose-50 text-rose-600'
      : tone === 'welcome'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : 'border-primary bg-primary/10 text-primary';
  const customs = value.filter((s) => !presets.includes(s));

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
        {/* 自定义标签(已添加)· 可删 */}
        {customs.map((s) => (
          <span key={s} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${activeClass}`}>
            {s}
            <button type="button" onClick={() => remove(s)} className="text-[13px] leading-none opacity-60 active:opacity-100" aria-label={`移除 ${s}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      {/* 自定义添加 */}
      <div className="mt-2 flex items-center gap-2">
        <input
          className="input-field flex-1 !py-1.5 !text-[12px]"
          value={draft}
          maxLength={12}
          placeholder="没有合适的?自己加一个…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button
          type="button"
          onClick={addCustom}
          className="shrink-0 rounded-full border border-ink-200 px-3 py-1.5 text-[12px] text-ink-700 active:scale-95"
        >
          添加
        </button>
      </div>
      {err && <div className="mt-1 text-[10px] text-rose-500">{err}</div>}
      {guard && <div className="mt-1 text-[10px] text-ink-400">可接受行为不得涉及私密/性服务等违规内容</div>}
    </div>
  );
}
