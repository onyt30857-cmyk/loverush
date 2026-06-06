'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Check, X, Heart, Info, ChevronRight, Lock, MapPin, Locate, ImageOff, AlertCircle } from 'lucide-react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { requestCoords } from '@/lib/geolocate';
import { useGoogleMaps } from '@/lib/use-google-maps';
import { t as tr } from '@/lib/i18n';
import type { MediaAsset } from '@/lib/upload';

interface TherapistMini {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  nationality: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  // 上门地址采集门控:outcall/both 才展开地址块
  serviceMode?: 'outcall' | 'incall' | 'both';
  basePriceJson?: unknown;
  skillsJson?: unknown;
}

// 上门楼栋照 · 本地态(mediaId 入库 · previewUrl 仅本地预览)
interface OutcallMediaEntry {
  mediaId: string;
  kind: 'image' | 'video';
  caption?: string;
  previewUrl?: string;
}

interface AvailabilitySlot {
  startAt: string; // ISO UTC
  endAt: string;
  available: boolean;
  reason?: 'booked' | 'closed' | 'time_off';
}

/** 生成接下来 7 天日期 chips */
function nextDates(count: number): Array<{ key: string; label: string; sub: string }> {
  const out: Array<{ key: string; label: string; sub: string }> = [];
  const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const now = new Date();
  // UTC 口径:与后端 availability 引擎(computeAvailability/scheduleOffer 都用 UTC date)对齐,
  // 否则正 UTC 偏移时区(如曼谷)过午夜后本地日期超前 UTC 一天 → ?date= 不匹配 → 拉空档死胡同。
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const label = i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `周${weekdayLabels[d.getUTCDay()]}`;
    const sub = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    out.push({ key, label, sub });
  }
  return out;
}

function fmtHHMM(iso: string): string {
  // slot.startAt 是 UTC 容器里的墙上时间(T21:00:00Z 即技师眼中 21:00),用 UTC getter 显原值,绝不本地转换
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
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

// Google Maps 反查地址(lat/lng → 门牌地址) · window.google 全局类型只声明了 places,这里局部补 Geocoder
interface GeocodeComp { long_name: string; short_name: string; types: string[] }
interface GeocodeResult { formatted_address: string; address_components?: GeocodeComp[] }
type GeocoderLike = {
  geocode: (
    req: { location: { lat: number; lng: number } },
    cb: (results: GeocodeResult[] | null, status: string) => void,
  ) => void;
};

/** 反查坐标 → 地址(没 Google Maps key/失败返 null,调用方保持手填) */
async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ address: string; city: string | null; area: string | null } | null> {
  // ① 优先前端 Google SDK(若配了 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,免一次后端往返)
  if (typeof window !== 'undefined') {
    const maps = window.google?.maps as unknown as { Geocoder?: new () => GeocoderLike } | undefined;
    if (maps?.Geocoder) {
      const geocoder = new maps.Geocoder();
      // ⚠ Telegram webview 里 geocode 回调可能永不触发 → Promise 卡死 → "定位中"卡住、不回填。
      //    故 race 一个 2.5s 超时,超时即放弃前端 SDK 走后端,绝不卡。
      const sdk = await Promise.race([
        new Promise<{ address: string; city: string | null; area: string | null } | null>((resolve) => {
          try {
            geocoder.geocode({ location: { lat, lng } }, (results, status) => {
              if (status === 'OK' && results && results[0]) {
                const r = results[0];
                const comps = r.address_components ?? [];
                const find = (tp: string) => comps.find((c) => c.types.includes(tp));
                resolve({
                  address: r.formatted_address,
                  city: find('locality')?.long_name ?? find('administrative_area_level_1')?.long_name ?? null,
                  area: find('sublocality')?.long_name ?? find('neighborhood')?.long_name ?? null,
                });
              } else {
                resolve(null);
              }
            });
          } catch {
            resolve(null);
          }
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (sdk) return sdk;
    }
  }
  // ② 前端 SDK 没 key / 加载失败 / 返回空 → 走后端 reverse(后端 GOOGLE_MAPS_API_KEY,确定可用)
  //    这才是修"点了定位没回填"的关键:之前只赌前端 SDK,没 key 就 null,地址框一直空。
  try {
    const d = await apiGet<{ address?: string; city?: string | null; area?: string | null } | null>(
      `/geo/reverse?lat=${lat}&lng=${lng}`,
    );
    if (d?.address) return { address: d.address, city: d.city ?? null, area: d.area ?? null };
  } catch {
    /* 后端也失败 → null,保持手填 */
  }
  return null;
}

export default function PriceLockPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  useGoogleMaps(); // 页面挂载即加载 Google Maps SDK,确保「用当前定位」点击时 Geocoder 已就绪可反查地址
  const [t, setT] = useState<TherapistMini | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [tip, setTip] = useState<number>(0);
  // M07 · 排班选时段
  const dateChips = nextDates(7);
  const [selectedDate, setSelectedDate] = useState<string>(dateChips[0]!.key);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null); // ISO UTC
  // 选时段卡跳来时 ?startAt= 待消费值(slots 拉回后匹配 available 则预选,只消费一次)
  const pendingSlotRef = useRef<string | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 闭环预检:客户心动金余额 + 后端权威应冻结额(/orders/quote)
  const [balance, setBalance] = useState<number | null>(null);
  const [quoteDeposit, setQuoteDeposit] = useState<number | null>(null);
  // M02b/M04 Phase 1 · 节目订单 · 从 ?show_id= 拿(用 window.location 避免触发 SSG prerender 失败)
  const [sourceShowId, setSourceShowId] = useState<string | null>(null);
  // M02b/M04 Phase 1 · 节目订单详情(深模式 · 锁定时段/类型/时长/价格 + 加项 checkbox)
  type ShowAddOn = { name: string; pricePoints: number; isDefault?: boolean };
  type ShowAddOnV2 = { name: string; priceFiat: number; isDefault?: boolean };
  const [sourceShow, setSourceShow] = useState<{
    category_name_zh: string | null;
    category_icon_emoji: string | null;
    duration_min: number;
    price_points: number;
    slots_remaining: number;
    start_time: string;
    therapist_display_name: string | null;
    add_ons: ShowAddOn[] | null;
    includes_note: string | null;
    excludes_note: string | null;
    // 0027 法币模式 · 老积分节目这些为 null
    currency_code: string | null;
    price_fiat: string | null; // numeric string
    add_ons_v2: ShowAddOnV2[] | null;
  } | null>(null);
  // 0027 · 公开 currencies + 汇率 · 客户端显示心动金 / 法币
  interface CurrencyDto {
    code: string;
    symbol: string;
    nameZh: string;
    decimals: number;
    pointsPerUnit: string | null;
  }
  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  // 加项选择(name → 是否选中) · sourceShow mode 用
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, boolean>>({});

  // both 技师:本单客户选上门还是到店(incall/outcall 技师固定,无需选)。默认上门(历史默认)。
  const [bothChoice, setBothChoice] = useState<'outcall' | 'incall'>('outcall');
  // === 上门地址采集(本单=上门才展开)===
  const [addr, setAddr] = useState('');            // customer_address(完整门牌 · 必填)
  const [addrNote, setAddrNote] = useState('');    // customer_address_note(找路指引 · 可选)
  const [lat, setLat] = useState<string | null>(null);   // customer_lat
  const [lng, setLng] = useState<string | null>(null);   // customer_lng
  const [areaName, setAreaName] = useState<string | null>(null); // customer_area_name
  const [addrMedia, setAddrMedia] = useState<OutcallMediaEntry[]>([]); // customer_address_media
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('show_id');
    if (sid) setSourceShowId(sid);
  }, []);

  // 0027 · 拉公开 currencies(失败静默 · 老积分模式不依赖)
  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<CurrencyDto[]>('/currencies');
        setCurrencies(data);
      } catch {
        /* 静默 · 老积分订单不需要 */
      }
    })();
  }, []);

  // 节目订单 · 拉 show 详情 → 自动锁定时段/时长 + 预选默认加项
  useEffect(() => {
    if (!sourceShowId) return;
    void (async () => {
      try {
        const data = await apiGet<typeof sourceShow>(`/shows/${sourceShowId}`);
        setSourceShow(data);
        // 自动锁:时长 + 起始时段(节目已定 · 客户不可改)
        if (data) {
          setSelectedDuration(data.duration_min);
          setSelectedSlot(new Date(data.start_time).toISOString());
          // 预选默认加项 (isDefault=true)
          const defaults: Record<string, boolean> = {};
          for (const a of data.add_ons ?? []) {
            if (a.isDefault) defaults[a.name] = true;
          }
          setSelectedAddOns(defaults);
        }
      } catch {
        // 静默 · banner 不显
      }
    })();
  }, [sourceShowId]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<TherapistMini>(`/therapists/${id}`);
        setT(data);
        const tiers = Array.isArray(data.basePriceJson) ? data.basePriceJson : [];
        const first = tiers[0] as { duration: number } | undefined;
        // url ?duration=X 优先(ServiceTierSheet 跳转携带)
        const urlDur = typeof window !== 'undefined'
          ? Number(new URLSearchParams(window.location.search).get('duration'))
          : 0;
        const initDur = Number.isFinite(urlDur) && urlDur > 0
          ? urlDur
          : (first?.duration ?? null);
        if (initDur) setSelectedDuration(initDur);
        // 选时段卡跳来 · 预选 date(?date=) + 待消费 slot(?startAt=)
        if (typeof window !== 'undefined') {
          const sp = new URLSearchParams(window.location.search);
          const d = sp.get('date');
          if (d && dateChips.some((c) => c.key === d)) setSelectedDate(d);
          const sa = sp.get('startAt');
          if (sa) pendingSlotRef.current = sa;
        }
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, [id]);

  // M07 · 拉可约时段(date 或 duration 变 · 选中过的 slot 清空)
  useEffect(() => {
    if (!t?.userId || !selectedDuration) return;
    setSlotsLoading(true);
    setSelectedSlot(null);
    void (async () => {
      try {
        const resp = await apiGet<{ slots: AvailabilitySlot[] }>(
          `/therapists/${t.userId}/availability?date=${selectedDate}&duration=${selectedDuration}`,
        );
        setSlots(resp.slots);
        // 选时段卡预选:URL ?startAt= 匹配某 available slot 则选中(消费一次,之后用户可自由改)
        if (pendingSlotRef.current) {
          const want = pendingSlotRef.current;
          pendingSlotRef.current = null;
          if (resp.slots.some((s) => s.startAt === want && s.available)) setSelectedSlot(want);
        }
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    })();
  }, [t?.userId, selectedDate, selectedDuration]);

  // 派生价格/时长(提前返回前算好,供下面两个 hook 用;t 可能尚未加载 → 全 null-safe)
  const priceTiers = (Array.isArray(t?.basePriceJson) ? t?.basePriceJson : []) as Array<{
    duration: number;
    pricePoints: number;
    currencyCode?: string;
    priceFiat?: number;
  }>;
  const priceOption = priceTiers.find((p) => p.duration === selectedDuration);
  const basePoints = sourceShow?.price_points ?? priceOption?.pricePoints ?? 0;
  const effectiveDuration = sourceShow?.duration_min ?? selectedDuration ?? 0;

  // 闭环:拉客户心动金余额(下单前预检用) · 必须在提前返回之前(Rules of Hooks,否则 t 加载后多调 hook → React #310 崩溃)
  useEffect(() => {
    void (async () => {
      try {
        const me = await apiGet<{ points?: { balance?: number } }>('/me');
        setBalance(Number(me.points?.balance ?? 0));
      } catch {
        setBalance(null); // 拉不到不阻断,退回"后端兜底拒绝"
      }
    })();
  }, []);

  // 闭环:拉后端权威应冻结心动金(口径与真实下单一致) · 必须在提前返回之前(Rules of Hooks)
  useEffect(() => {
    if (!t?.id || basePoints <= 0 || effectiveDuration <= 0) {
      setQuoteDeposit(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const q = await apiPost<{ depositPoints: number }>('/orders/quote', {
          therapist_id: t.id,
          service_snapshot: { skills: selectedSkills, durationMin: effectiveDuration, pricePoints: basePoints },
          source_show_id: sourceShowId ?? undefined,
        });
        if (!cancelled) setQuoteDeposit(Number(q.depositPoints ?? 0));
      } catch {
        if (!cancelled) setQuoteDeposit(null); // 报价失败 → 用客户端估算兜底
      }
    })();
    return () => { cancelled = true; };
  }, [t?.id, basePoints, effectiveDuration, sourceShowId, selectedSkills]);

  if (!t) {
    return (
      <div className="mobile-container bg-white">
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </div>
    );
  }

  const skills = (Array.isArray(t.skillsJson) ? t.skillsJson : []) as Array<{ skill: string; level: number }>;
  // priceTiers/priceOption/basePoints/effectiveDuration 已在提前返回之前算好(供 hook 用),此处直接复用
  // 加项总价(sourceShow mode)
  const addOnTotal = sourceShow
    ? (sourceShow.add_ons ?? []).reduce((sum, a) => sum + (selectedAddOns[a.name] ? a.pricePoints : 0), 0)
    : 0;
  const totalPoints = basePoints + addOnTotal + tip;

  // 0027 法币模式判定 + 计算 · sourceShow 优先,否则用 priceOption.currencyCode(老 basePrice 走 fiat 兜底)
  const isFiatMode = !!(sourceShow?.currency_code || priceOption?.currencyCode);
  const currency = isFiatMode
    ? currencies.find((c) => c.code === (sourceShow?.currency_code ?? priceOption?.currencyCode))
    : undefined;
  const fxRate = currency?.pointsPerUnit ? parseFloat(currency.pointsPerUnit) : null;
  function fmtFiat(amount: number): string {
    if (!currency) return amount.toString();
    return `${currency.symbol}${amount.toLocaleString('en-US', {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    })}`;
  }
  // sourceShow 模式 → 节目 price_fiat;非 sourceShow + 老 basePrice 有 fiat → 用 priceOption.priceFiat
  const baseFiat = isFiatMode
    ? sourceShow?.price_fiat
      ? parseFloat(sourceShow.price_fiat)
      : (priceOption?.priceFiat ?? 0)
    : 0;
  // sourceShow 可能为 null(普通 base_price 下单 · 无节目加项)→ 用可选链兜底
  // 注:技师 base_price 补了 currencyCode+priceFiat 后,普通下单也会进 isFiatMode,
  //    此处若用 sourceShow! 非空断言会在 null 上崩溃("应用出错了")
  const addOnFiat = isFiatMode
    ? (sourceShow?.add_ons_v2 ?? []).reduce(
        (sum, a) => sum + (selectedAddOns[a.name] ? a.priceFiat : 0),
        0,
      )
    : 0;
  const totalFiat = baseFiat + addOnFiat; // 小费走积分 · 不入线下应付
  // 心动金 = (基础 + 加项) 等值积分 × 10% · 不含小费
  const totalEquivalentPoints = fxRate ? Math.ceil(totalFiat * fxRate) : basePoints + addOnTotal;
  const depositPoints = Math.ceil(totalEquivalentPoints * 0.1);
  // 平台冻结积分:心动金 + 小费(小费走积分通道 · 决策④A)
  const platformPoints = depositPoints + tip;

  // (余额预检 + /orders/quote 报价 两个 useEffect 已上移到提前返回之前 · Rules of Hooks)
  // 应冻结额:优先后端权威值,拉不到退回客户端估算
  const requiredDeposit = quoteDeposit ?? depositPoints;
  // 余额不足(余额已知 且 < 应冻结)→ 拦截下单,引导充值
  const insufficientBalance = balance != null && balance < requiredDeposit;
  const shortfall = insufficientBalance ? requiredDeposit - (balance ?? 0) : 0;

  function toggleSkill(s: string) {
    setSelectedSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  // === 本单服务方式 ===
  const isBoth = t?.serviceMode === 'both';
  // 本单是否上门:outcall 技师恒是;both 技师看客户选;incall 技师否
  const isOutcall = t?.serviceMode === 'outcall' || (isBoth && bothChoice === 'outcall');

  // 下单阻塞原因(按优先级取第一个未满足项,显示在锁定按钮上方) · 余额不足单独走充值引导
  const blockReason: string | null =
    !sourceShow && !priceOption
      ? '请先选择服务时长'
      : !selectedSlot
        ? '请在上方选择预约时段'
        : isOutcall && addr.trim().length === 0
          ? '请填写完整上门地址'
          : null;
  // 全部条件满足(且余额够)才允许锁定下单
  const canSubmit = !blockReason && !insufficientBalance && !submitting;

  // 一键「使用当前定位」· 一次性取坐标(不写偏好 · 仅本单用)
  // TG Mini App 内走 Telegram LocationManager,普通浏览器走 navigator.geolocation(requestCoords 自动判断)
  async function useCurrentLocation() {
    setLocateError(null);
    setLocating(true);
    const r = await requestCoords();
    if (!r.ok) {
      setLocating(false);
      setLocateError(
        r.reason === 'denied'
          ? tr('addr.errLocDenied','定位被拒绝 · 可手动输入地址')
          : tr('addr.errLocUnavailable','暂时拿不到定位 · 请手动输入地址'),
      );
      return;
    }
    setLat(String(r.lat));
    setLng(String(r.lng));
    // 反查地址自动回填(Google Maps Geocoder · 没 key/失败则保持手填,不阻断)
    const geo = await reverseGeocode(r.lat, r.lng);
    setLocating(false);
    if (geo) {
      setAddr(geo.address); // 回填街道地址,用户在此基础上补门牌/楼层
      setAreaName(geo.area ?? geo.city ?? null);
    }
  }

  function addAddrMedia(asset: MediaAsset) {
    const kind: 'image' | 'video' = (asset.mimeType ?? '').startsWith('video/') ? 'video' : 'image';
    setAddrMedia((prev) => [
      ...prev,
      { mediaId: asset.id, kind, previewUrl: asset.thumbnailUrl ?? asset.publicUrl ?? undefined },
    ]);
  }
  function removeAddrMedia(i: number) {
    setAddrMedia((prev) => prev.filter((_, j) => j !== i));
  }

  async function submit() {
    // sourceShow 模式不依赖客户挑 priceOption
    if (!sourceShow && !priceOption) return;
    if (!selectedSlot) {
      setError('请选时段');
      return;
    }
    // 上门服务:完整地址必填(后端也会校验,这里前置拦更友好)
    if (isOutcall && addr.trim().length === 0) {
      setError(tr('addr.errAddrRequired', '上门服务请填写完整上门地址 · 技师确认后才看得到'));
      return;
    }
    // 闭环防御:余额不足绝不发起注定失败的请求(正常已被按钮禁用拦住)
    if (insufficientBalance) {
      setError(`心动金余额不足 · 还差 ${shortfall} · 请先充值`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // itemsBreakdown:节目模式拼 add_ons,普通模式只拼小费
      const itemsBreakdown: Array<{ name: string; pricePoints: number }> = [];
      if (sourceShow) {
        for (const a of sourceShow.add_ons ?? []) {
          if (selectedAddOns[a.name]) itemsBreakdown.push({ name: a.name, pricePoints: a.pricePoints });
        }
      }
      if (tip > 0) itemsBreakdown.push({ name: '小费', pricePoints: tip });

      const order = await apiPost<{ id: string }>('/orders', {
        therapist_id: t!.id,
        scheduled_at: selectedSlot,
        service_snapshot: {
          skills: selectedSkills,
          durationMin: effectiveDuration,
          pricePoints: basePoints,
          itemsBreakdown: itemsBreakdown.length > 0 ? itemsBreakdown : undefined,
        },
        // M02b/M04 Phase 1 · 节目订单 · 后端 atomic claimShowSlot(失败 409 已售罄)
        source_show_id: sourceShowId ?? undefined,
        // 本单服务方式 · 仅 both 技师带(客户选的);incall/outcall 技师后端自动定
        service_mode: isBoth ? bothChoice : undefined,
        // 上门服务地址 · 本单=上门才带(到店忽略)· 后端校验服务范围
        ...(isOutcall
          ? {
              customer_address: addr.trim(),
              customer_address_note: addrNote.trim() || undefined,
              customer_lat: lat ?? undefined,
              customer_lng: lng ?? undefined,
              customer_area_name: areaName ?? undefined,
              customer_address_media:
                addrMedia.length > 0
                  ? addrMedia.map((m) => ({
                      mediaId: m.mediaId,
                      kind: m.kind,
                      ...(m.caption?.trim() ? { caption: m.caption.trim() } : {}),
                    }))
                  : undefined,
            }
          : {}),
      });
      await apiPost(`/orders/${order.id}/submit`);
      router.replace(`/order/${order.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        // 409 已售罄给更友好提示(后端 message 含 'sold out')
        const msg = err.payload.message;
        if (msg.includes('sold out') || msg.includes('售罄') || msg.includes('not available')) {
          setError('该节目已被抢光 · 试试其他节目?');
        } else {
          setError(msg);
        }
      } else setError(String((err as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === Top nav === */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">服务确认</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">PRICE LOCK</div>
        </div>
        <div className="h-9 w-9" />
      </header>

      {/* M02b/M04 Phase 1 · 节目订单 banner · 视觉提示客户拍的是哪个节目 */}
      {sourceShow && (
        <div className="mx-4 mt-3 rounded-2xl bg-gradient-to-br from-primary/10 to-warm-100 border border-primary/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">🎫 节目订单</span>
            <span className="text-[10px] text-ink-500">剩 {sourceShow.slots_remaining} 名额 · 售罄前可拍</span>
          </div>
          <div className="text-[13px] font-semibold text-ink-800">
            {sourceShow.category_icon_emoji} {sourceShow.category_name_zh} · {sourceShow.duration_min} 分钟 ·{' '}
            {isFiatMode ? (
              <span className="text-primary">{fmtFiat(baseFiat)}</span>
            ) : (
              <span className="text-primary">{sourceShow.price_points} 积分</span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-600">
            {new Date(sourceShow.start_time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {sourceShow.therapist_display_name && ` · ${sourceShow.therapist_display_name}`}
          </div>
        </div>
      )}

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

      {/* === both 技师 · 本单选上门/到店 === */}
      {isBoth && (
        <section className="px-4 pb-3">
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
            <div className="mb-2 text-[13px] font-medium text-ink-800">{tr('addr.bothQ','这次想怎么约?')}</div>
            <div className="grid grid-cols-2 gap-2">
              {([['outcall', tr('addr.modeOutcall','上门'), tr('addr.modeOutcallSub','技师上门到你那')], ['incall', tr('addr.modeIncall','到店'), tr('addr.modeIncallSub','你去技师店里')]] as const).map(([v, label, sub]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBothChoice(v)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
                    bothChoice === v ? 'border-primary bg-primary/5' : 'border-warm-100 bg-white'
                  }`}
                >
                  <div className={`text-[13px] font-semibold ${bothChoice === v ? 'text-primary' : 'text-ink-800'}`}>{label}</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">{sub}</div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* === 上门地址采集 · 本单=上门才展开(到店不显) === */}
      {isOutcall && (
        <section className="px-4 pb-3">
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-serif-cn text-sm font-semibold text-ink-900">{tr('addr.outcallTitle','上门地址')}</span>
              <span className="font-cormorant italic text-[10px] tracking-wider text-warm-700">OUTCALL ADDRESS</span>
            </div>
            <p className="mb-3 flex items-start gap-1.5 text-[10.5px] leading-5 text-ink-500">
              <Lock className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
              <span>{tr('addr.privacyNote','技师确认接单前只看得到你的大致区域,看不到门牌;确认后才解锁完整地址给她导航上门。')}</span>
            </p>

            {/* 一键定位 + 完整地址 */}
            <div className="mb-2">
              <button
                type="button"
                onClick={() => void useCurrentLocation()}
                disabled={locating}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 py-2 text-[12px] font-medium text-primary transition active:scale-[0.99] disabled:opacity-60"
              >
                <Locate className={`h-3.5 w-3.5 ${locating ? 'animate-pulse' : ''}`} />
                {locating ? tr('addr.locating','定位中…') : lat && lng ? tr('addr.relocate','已定位 · 重新定位') : tr('addr.useLocation','使用当前定位')}
              </button>
              {lat && lng && (
                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-[11px] text-emerald-700">
                  <MapPin className="h-3 w-3" />
                  {tr('addr.locRecorded','已记录定位')}{areaName ? ` · ` : ''} · {tr('addr.fillDetail','请在下方补全门牌/楼层')}
                </div>
              )}
              {locateError && (
                <div className="mb-2 rounded-lg bg-warning-500/10 px-2.5 py-1.5 text-[11px] text-warning-600">
                  {locateError}
                </div>
              )}
            </div>

            <div className="mb-1 text-[11px] font-medium text-ink-700">
              {tr('addr.fullAddrLabel','完整上门地址')} <span className="text-primary">*</span>
            </div>
            {/* 普通 textarea(不用 Places 组件:前端无 Google key 时 autocomplete 不工作,
                还会在 iOS/webview 出 autofill 感叹号·只读错觉)。定位回填到这,客户手动补门牌。 */}
            <textarea
              value={addr}
              onChange={(e) => setAddr(e.target.value.slice(0, 200))}
              placeholder={tr('addr.addrPlaceholder', '楼盘/小区 + 门牌/楼层 · 越具体越好')}
              rows={2}
              className="w-full resize-none rounded-xl border border-ink-100 px-3 py-2.5 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-primary focus:outline-none"
            />
            <div className="mb-3 mt-1 text-[10px] text-ink-400">
              定位带出大致位置后,请补全到具体门牌/房号(如:XX 苑 3 栋 1502)
            </div>

            {/* 找路指引(可选) */}
            <div className="mb-1 text-[11px] font-medium text-ink-700">找路指引(可选)</div>
            <textarea
              className="h-16 w-full rounded-xl border border-ink-100 p-3 text-[13px] focus:border-primary focus:outline-none"
              value={addrNote}
              onChange={(e) => setAddrNote(e.target.value.slice(0, 200))}
              maxLength={200}
              placeholder={tr('addr.guidePlaceholder','如:进小区南门 · 门禁码 #1234 · 电梯到 15 层右转')}
            />
            <div className="mb-3 mt-0.5 text-right text-[10px] text-ink-400">{addrNote.length}/200</div>

            {/* 楼栋照(可选) */}
            <div className="mb-1 text-[11px] font-medium text-ink-700">楼栋 / 门牌照(可选)</div>
            <div className="mb-2 text-[10px] text-ink-400">
              拍一张楼栋/门口/门牌 · 技师照着走不迷路(图最大 20MB · 视频最大 50MB · 需审核)
            </div>
            {addrMedia.length > 0 && (
              <div className="mb-2 grid grid-cols-3 gap-2">
                {addrMedia.map((m, i) => (
                  <div
                    key={`${m.mediaId}-${i}`}
                    className="relative aspect-square overflow-hidden rounded-xl border border-warm-100 bg-warm-50"
                  >
                    {m.previewUrl ? (
                      m.kind === 'video' ? (
                        <div className="flex h-full w-full items-center justify-center bg-ink-800 text-white">▶</div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.previewUrl} alt="" className="h-full w-full object-cover" />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-300">
                        <ImageOff className="h-5 w-5" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAddrMedia(i)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white active:scale-90"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <MediaUploader purpose="customer_location_guide" basePath="/me" onComplete={addAddrMedia}>
              <button
                type="button"
                className="w-full rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
              >
                {tr('addr.uploadPhoto','+ 上传楼栋 / 门牌照')}
              </button>
            </MediaUploader>
          </div>
        </section>
      )}

      {/* === 时长选择 · sourceShow 模式锁定为只读 === */}
      {sourceShow ? (
        <section className="px-4 pb-3">
          <h3 className="mb-2 font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">
            DURATION · 时长(节目已定)
          </h3>
          <div className="flex items-center justify-between rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-primary" />
              <span className="text-serif-cn text-base font-semibold text-ink-900">{sourceShow.duration_min} 分钟</span>
            </div>
            <div className="text-right">
              {isFiatMode ? (
                <>
                  <div className="num font-display text-base font-semibold text-primary">{fmtFiat(baseFiat)}</div>
                  <div className="text-[9px] text-ink-500">线下面付</div>
                </>
              ) : (
                <>
                  <div className="num font-display text-base font-semibold text-primary">{sourceShow.price_points}</div>
                  <div className="text-[9px] text-ink-500">积分</div>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
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
            const tierCur = p.currencyCode ? currencies.find((c) => c.code === p.currencyCode) : undefined;
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
                  {tierCur && p.priceFiat ? (
                    <>
                      <div className="num font-display text-base font-semibold text-primary">
                        {tierCur.symbol}{p.priceFiat.toLocaleString('en-US', { minimumFractionDigits: tierCur.decimals, maximumFractionDigits: tierCur.decimals })}
                      </div>
                      <div className="text-[9px] text-ink-500">线下面付</div>
                    </>
                  ) : (
                    <>
                      <div className="num font-display text-base font-semibold text-primary">{p.pricePoints}</div>
                      <div className="text-[9px] text-ink-500">积分</div>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
      )}

      {/* === M07 · 选日期 + 时段 · sourceShow 模式锁定为只读 === */}
      {sourceShow ? (
        <section className="px-4 pb-2">
          <h3 className="mb-2 font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">
            WHEN · 时段(节目已定)
          </h3>
          <div className="flex items-center gap-2 rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <span className="text-serif-cn text-[15px] font-semibold text-ink-900">
              {new Date(sourceShow.start_time).toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="ml-auto text-[10px] text-ink-500">不可改</span>
          </div>
        </section>
      ) : (
      <section className="px-4 pb-2">
        <h3 className="mb-2 font-cormorant italic text-[10px] tracking-[0.3em] text-ink-500">
          WHEN · 什么时候
        </h3>

        {/* 日期 chips 横滑 7 天 · whitespace-nowrap 防中文字竖排 · flex-shrink-0 防压缩 */}
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2.5">
          {dateChips.map((d) => {
            const on = selectedDate === d.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDate(d.key)}
                className={`flex flex-shrink-0 flex-col items-center justify-center whitespace-nowrap rounded-2xl border px-4 py-2.5 transition active:scale-95 ${
                  on
                    ? 'border-primary bg-gradient-cta text-white shadow-warm-sm'
                    : 'border-warm-100 bg-white text-ink-700'
                }`}
                style={{ minWidth: 60 }}
              >
                <span className={`text-[13px] font-semibold leading-tight ${on ? 'text-white' : 'text-ink-900'}`}>
                  {d.label}
                </span>
                <span className={`mt-0.5 text-[10px] leading-none num ${on ? 'text-white/85' : 'text-ink-400'}`}>
                  {d.sub}
                </span>
              </button>
            );
          })}
        </div>

        {/* 时段 grid */}
        <div className="rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-xs">
          {slotsLoading ? (
            <div className="py-6 text-center text-[11px] text-ink-400">加载可约时段…</div>
          ) : !slots || slots.length === 0 ? (
            <div className="py-6 text-center text-[11.5px] text-ink-500">
              当天技师不接单 · 试别的日子
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {slots.map((s) => {
                const on = selectedSlot === s.startAt;
                const disabled = !s.available;
                return (
                  <button
                    key={s.startAt}
                    type="button"
                    onClick={() => s.available && setSelectedSlot(s.startAt)}
                    disabled={disabled}
                    className={`rounded-xl border py-1.5 text-[12.5px] font-medium num transition ${
                      on
                        ? 'border-primary bg-primary text-white shadow-warm-sm'
                        : disabled
                          ? 'border-ink-100 bg-ink-50 text-ink-300 line-through cursor-not-allowed'
                          : 'border-warm-100 bg-white text-ink-800 hover:border-warm-300 active:scale-95'
                    }`}
                    title={s.reason === 'booked' ? '已被约' : s.reason === 'time_off' ? '技师休假' : undefined}
                  >
                    {fmtHHMM(s.startAt)}
                  </button>
                );
              })}
            </div>
          )}
          {selectedSlot && (
            <div className="mt-2.5 rounded-lg bg-primary/5 px-2.5 py-1.5 text-center text-[11px] text-primary">
              已选 {fmtHHMM(selectedSlot)} 开始 · {priceOption?.duration ?? 0} 分钟
            </div>
          )}
        </div>
      </section>
      )}

      {/* === sourceShow 节目加项 · checkbox 列表(节目模式) ===  */}
      {sourceShow && (() => {
        const list = isFiatMode
          ? (sourceShow.add_ons_v2 ?? []).map((a) => ({ name: a.name, priceLabel: `+${fmtFiat(a.priceFiat)}` }))
          : (sourceShow.add_ons ?? []).map((a) => ({ name: a.name, priceLabel: `+${a.pricePoints} pts` }));
        if (list.length === 0) return null;
        return (
        <section className="px-4 pb-2">
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-serif-cn text-sm font-semibold text-ink-900">节目加项 (按需勾选)</span>
              <span className="font-cormorant italic text-[10px] tracking-wider text-warm-700">ADD-ONS</span>
            </div>
            <div className="space-y-2">
              {list.map((a) => {
                const on = !!selectedAddOns[a.name];
                return (
                  <label
                    key={a.name}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition active:scale-[0.99] ${
                      on ? 'border-primary bg-primary/5' : 'border-ink-100 bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setSelectedAddOns((prev) => ({ ...prev, [a.name]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-[#FF5577]"
                    />
                    <span className="flex-1 text-[13px] text-ink-900">{a.name}</span>
                    <span className="num text-[13px] font-semibold text-primary">{a.priceLabel}</span>
                  </label>
                );
              })}
            </div>
            {sourceShow.includes_note && (
              <div className="mt-3 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-[10.5px] leading-5 text-emerald-700">
                <span className="font-semibold">含:</span> {sourceShow.includes_note}
              </div>
            )}
            {sourceShow.excludes_note && (
              <div className="mt-1.5 rounded-lg bg-rose-50/60 px-2.5 py-1.5 text-[10.5px] leading-5 text-rose-700">
                <span className="font-semibold">不含:</span> {sourceShow.excludes_note}
              </div>
            )}
          </div>
        </section>
        );
      })()}

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
              const label = v === 0
                ? '无'
                : isFiatMode && currency && fxRate
                  ? `+${fmtFiat(v / fxRate)}`
                  : `+${v}`;
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
                  {label}
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
            <div className="mt-0.5">
              {isFiatMode ? (
                <>
                  服务完成 <span className="font-semibold text-emerald-600">自动全额退还</span> ·
                  客户鸽子扣留 50/50 分账 · 技师鸽子全退 + 信用降级
                </>
              ) : (
                <>预约成功冻结 · <span className="font-semibold text-emerald-600">服务完成自动退还</span> · 取消按规则扣</>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* === 总价卡 · 法币模式拆 2 块 === */}
      {isFiatMode ? (
        <section className="px-4 pt-3 space-y-2">
          {/* Block 1 · 线下面付 */}
          <div className="rounded-2xl bg-white border border-warm-200 p-4 shadow-warm-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-serif-cn text-sm font-semibold text-ink-900">应付总额(线下面付)</span>
              <span className="font-cormorant italic text-[9px] tracking-[0.3em] text-warm-700">OFFLINE</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink-600">节目基础({effectiveDuration} 分钟)</span>
                <span className="num text-ink-900">{fmtFiat(baseFiat)}</span>
              </div>
              {(sourceShow?.add_ons_v2 ?? []).filter((a) => selectedAddOns[a.name]).map((a) => (
                <div key={a.name} className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-600">+ {a.name}</span>
                  <span className="num text-primary">+{fmtFiat(a.priceFiat)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-warm-200/60 pt-2 flex items-baseline justify-between">
              <span className="text-serif-cn text-sm font-semibold text-ink-900">线下面付</span>
              <div className="text-right">
                <span className="num font-display text-2xl font-bold text-primary">{fmtFiat(totalFiat)}</span>
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-ink-500 leading-4">
              服务时面对面给技师 · <span className="font-semibold text-emerald-600">现金或转账</span> · 不过平台
            </div>
          </div>

          {/* Block 2 · 平台冻结心动金 */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50/60 to-warm-50 border border-emerald-100 p-4 shadow-warm-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-serif-cn text-sm font-semibold text-emerald-700">平台冻结心动金</span>
              <span className="font-cormorant italic text-[9px] tracking-[0.3em] text-emerald-600">DEPOSIT</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink-600">心动金(总额 10%)</span>
                <span className="num text-ink-900">{fmtFiat(totalFiat * 0.1)}</span>
              </div>
              {tip > 0 && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-600">心意礼物</span>
                  <span className="num text-warning-500">+{fmtFiat(tip / (fxRate || 1))}</span>
                </div>
              )}
            </div>
            <div className="mt-2 border-t border-emerald-100 pt-2 flex items-baseline justify-between">
              <span className="text-serif-cn text-sm font-semibold text-emerald-700">本次冻结</span>
              <div className="text-right">
                <span className="num font-display text-2xl font-bold text-emerald-700">
                  {fmtFiat(totalFiat * 0.1 + (fxRate ? tip / fxRate : 0))}
                </span>
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-ink-500 leading-4">
              服务完成 <span className="font-semibold text-emerald-600">心动金自动退回</span> · 心意礼物直接到技师
            </div>
          </div>
        </section>
      ) : (
      <section className="px-4 pt-3">
        <div className="rounded-2xl bg-gradient-to-br from-warm-50 to-rose-50 p-4 shadow-warm-sm">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-ink-600">
                {sourceShow ? `节目基础 (${effectiveDuration} 分钟)` : `基础服务 (${selectedDuration ?? '—'} 分钟)`}
              </span>
              <span className="num text-ink-900">{basePoints} pts</span>
            </div>
            {sourceShow && (sourceShow.add_ons ?? []).filter((a) => selectedAddOns[a.name]).map((a) => (
              <div key={a.name} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-600">+ {a.name}</span>
                <span className="num text-primary">+{a.pricePoints} pts</span>
              </div>
            ))}
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
      )}

      {/* === Sticky CTA === */}
      <div className="sticky bottom-0 z-30 mt-auto shrink-0 border-t border-warm-100 bg-white/95 px-4 py-3 backdrop-blur-md">
        {/* 报错就近锁定按钮显示(显眼·始终可见,不用往下滑找) · 红底图标抓眼 */}
        {error && (
          <div className="mb-2 flex items-start gap-1.5 rounded-xl border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-[12px] font-medium text-warning-700">
            <AlertCircle className="mt-px h-4 w-4 shrink-0 text-warning-600" />
            <span className="flex-1">{error}</span>
          </div>
        )}
        {/* 心动金余额 · 始终显示(已知时),让客户清楚够不够;余额不足时下面的警示框已含余额,不重复 */}
        {balance != null && !insufficientBalance && (
          <div className="mb-2 flex items-center justify-center gap-1 text-[11px] text-ink-500">
            <Heart className="h-3 w-3 fill-emerald-500 text-emerald-500" />
            心动金余额 <span className="num font-semibold text-ink-800">{balance}</span>
            <span className="text-ink-300">·</span> 本单冻结 <span className="num font-semibold text-emerald-700">{requiredDeposit}</span>
            <span className="text-ink-400">(服务后退还)</span>
          </div>
        )}

        {insufficientBalance ? (
          <>
            {/* 余额不足 · 拦截下单 + 引导充值(绝不发起注定失败的请求) */}
            <div className="mb-2 flex items-center justify-center gap-1.5 rounded-xl border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-[11px] text-ink-700">
              需冻结心动金 <span className="num font-semibold text-emerald-700">{requiredDeposit}</span> ·
              余额 <span className="num font-semibold text-ink-900">{balance ?? 0}</span> ·
              还差 <span className="num font-semibold text-warning-600">{shortfall}</span>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/me/recharge?need=${requiredDeposit}&back=${encodeURIComponent(pathname)}`)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98]"
            >
              <Heart className="h-4 w-4 fill-white" />
              <span className="text-serif-cn text-sm font-medium tracking-wider">去充值心动金</span>
              <ChevronRight className="h-4 w-4" />
            </button>
            <p className="mt-2 text-center text-[10px] leading-4 text-ink-500">
              充值后回来即可下单 · 心动金<span className="font-semibold text-emerald-600">服务完成自动退还</span>
            </p>
          </>
        ) : blockReason ? (
          /* 还有条件没满足 · 把原因直接显示在按钮上(灰态不可点),满足后才变成可点的锁定按钮 */
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-warm-200 bg-warm-50 py-3.5 text-ink-400"
          >
            <Info className="h-4 w-4" />
            <span className="text-serif-cn text-sm font-medium tracking-wider">{blockReason}</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98] disabled:opacity-50"
            >
              <Heart className="h-4 w-4 fill-white" />
              <span className="text-serif-cn text-sm font-medium tracking-wider">
                {submitting
                  ? sourceShow ? '抢单中…' : '锁定中…'
                  : isFiatMode
                    ? `锁定时段 · 冻结心动金 ${fmtFiat(totalFiat * 0.1 + (fxRate ? tip / fxRate : 0))}`
                    : `${sourceShow ? '立即拍单' : '锁定服务'} · ${totalPoints} 积分`}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
            <p className="mt-2 text-center text-[10px] leading-4 text-ink-500">
              点击即同意《服务协议》·{' '}
              {isFiatMode ? (
                <>线下面付 <span className="font-semibold text-primary">{fmtFiat(totalFiat)}</span> · 心动金<span className="font-semibold text-emerald-600">服务后自动退还</span></>
              ) : (
                <>心动金<span className="font-semibold text-emerald-600">服务完成自动退还</span></>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
