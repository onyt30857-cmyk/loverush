'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Heart,
  MapPin,
  ChevronDown,
  Globe,
  Bell,
  Search,
  Sparkles,
  Star,
  ArrowRight,
  Compass,
  MessageCircle,
  Calendar,
  User,
  Languages,
  ShieldCheck,
  SlidersHorizontal,
  ChevronUp,
  X,
  Navigation,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { apiGet } from '@/lib/api';
// 性能修复:BottomSheet 用 dynamic ssr:false 懒加载 · 首屏 page chunk 砍 ~100KB
// LocaleCode 是 pure type · 仍静态 import
import type { LocaleCode } from '@/components/LocaleSheet';
import { useGpsAutoUpload } from '@/lib/use-gps';
// 首页筛选与 discover 全对齐:共享 DiscoverFilters 状态 + chips 逻辑 + FilterDrawer
import {
  FilterDrawer,
  countActiveFilters,
  EMPTY_FILTERS,
  type DiscoverFilters,
} from '@/components/discover/FilterDrawer';
import { CHIPS, isChipActive, toggleChip, buildQuery, queryToString } from '@/components/discover/chips';
import { requestCoords } from '@/lib/geolocate';
const LocaleSheet = dynamic(
  () => import('@/components/LocaleSheet').then((m) => m.LocaleSheet),
  { ssr: false },
);
const LocationSheet = dynamic(
  () => import('@/components/LocationSheet').then((m) => m.LocationSheet),
  { ssr: false },
);
// v5 语音助理 [[loverush_m03_audit_2026_06_01]] · 中央按钮触发 sheet 不跳页
const VoiceAssistantSheet = dynamic(
  () => import('@/components/VoiceAssistantSheet').then((m) => m.VoiceAssistantSheet),
  { ssr: false },
);
import { useAuth } from '@/lib/auth';
import { useUnreadCount } from '@/lib/notifications';
import { useServerEvents } from '@/lib/sse';
import { useLocationPref, setLocationPref } from '@/lib/location';
import { mutate as swrMutate } from 'swr';
import { HeroPicksCarousel, type HeroPick } from '@/components/home/HeroPicksCarousel';

interface ApiTherapist {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  nationality: string | null;
  heightCm: number | null;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  rating: number;
  ratingCount: number;
  completedOrders: number;
  onlineStatus: string;
  tags: string[] | null;
  languages: string[] | null;
  basePriceJson: unknown;
  // 0027 派生 · 该技师默认法币
  defaultCurrencyCode?: string | null;
  // 服务方式:上门/到店/两者皆可
  serviceMode?: 'outcall' | 'incall' | 'both';
}

interface CardData {
  href: string;
  cn: string;
  en: string;
  age: number;
  height: number;
  country: string;
  langs: string;
  type: string;
  currency: string;
  price: string;
  unit: string;
  img: string;
  imgPos: string;
  heightCls: 'h-tall' | 'h-mid' | 'h-short';
  badge: { kind: 'online'; text: string } | { kind: 'vip'; text: string };
  score: string;
  distance: string;
  serviceMode?: 'outcall' | 'incall' | 'both';
}

/** 服务方式标签(上门/到店/两者)· 复用详情页口径 */
function serviceModeLabel(m?: 'outcall' | 'incall' | 'both'): string | null {
  if (!m) return null;
  return m === 'incall' ? '🏪 到店' : m === 'both' ? '🏠 上门 · 🏪 到店' : '🏠 上门';
}

const HEIGHTS = ['h-tall', 'h-mid', 'h-short', 'h-tall', 'h-mid', 'h-mid', 'h-short', 'h-tall', 'h-mid', 'h-mid', 'h-short', 'h-tall'] as const;

// 首页承诺区/品牌脚注 · 后台 app_config(home.*)可改 · 缺则回退(永不假装数据)
interface HomePromise { subtitle: string; title: string; items: Array<{ title: string; sub: string }> }
interface HomeFooter { wordmark: string; tagline: string }
const HOME_PROMISE_FALLBACK: HomePromise = {
  subtitle: 'Why LoveRush',
  title: '28,000+ 男人的私选',
  items: [
    { title: '语言不通也能撩', sub: '中/英/泰/越/马/印 · 实时翻译' },
    { title: '越用越懂你的口味', sub: '第 2 次起精准命中 · 不走弯路' },
    { title: '绝对隐身 · 谁也不知道', sub: '分级隐私 · 计算器伪装 · 一键隐身' },
  ],
};
const HOME_FOOTER_FALLBACK: HomeFooter = { wordmark: 'LOVERUSH', tagline: '东南亚 · 男人的私选清单' };

function apiToCard(
  t: ApiTherapist,
  idx: number,
  currencies: Array<{ code: string; symbol: string; decimals: number }>,
): CardData {
  const score = ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
  const tiers = (Array.isArray(t.basePriceJson) ? t.basePriceJson : []) as Array<{
    duration: number;
    pricePoints: number;
    currencyCode?: string;
    priceFiat?: number;
  }>;
  const first = tiers[0];
  // 0027:优先 fiat 显示(技师定的法币)· 否则 fallback 积分
  let price = '—';
  let currencyLabel = '积';
  if (first) {
    const tierCur = first.currencyCode ? currencies.find((c) => c.code === first.currencyCode) : undefined;
    if (tierCur && first.priceFiat) {
      currencyLabel = tierCur.symbol;
      price = first.priceFiat.toLocaleString('en-US', {
        minimumFractionDigits: tierCur.decimals,
        maximumFractionDigits: tierCur.decimals,
      });
    } else {
      price = first.pricePoints.toLocaleString();
    }
  }
  const unit = first ? `/${first.duration}` : '';
  const lang = (t.languages ?? []).slice(0, 3).map(l => l === 'zh' ? '中' : l === 'en' ? '英' : l === 'th' ? '泰' : l === 'vi' ? '越' : l === 'ms' ? '马' : l === 'id' ? '印' : l).join('/');
  const type = (t.tags ?? [])[0] ?? '';
  return {
    href: `/therapist/${t.id}`,
    cn: t.displayName ?? '—',
    en: '',
    age: 0,
    height: t.heightCm ?? 0,
    country: t.serviceCity ?? '',
    langs: lang || '中',
    type: type || '按摩',
    currency: currencyLabel,
    price,
    unit,
    img: t.avatarUrl ?? '',
    imgPos: 'center 25%',
    heightCls: HEIGHTS[idx % HEIGHTS.length]!,
    badge: t.onlineStatus === 'online' ? { kind: 'online', text: '今晚在线' } : { kind: 'vip', text: 'HOT' },
    score,
    distance: `${(2 + idx * 0.3).toFixed(1)}km`,
    serviceMode: t.serviceMode,
  };
}

/**
 * rank 加权抖动取前 n:高分(原序靠前)大概率仍靠前,但位置每次(按 seed)抖动 → 每次进站位置不同、防视觉疲劳。
 * window 越大越随机(grid 用满 window=全洗牌;hero 用小 window=保质量微抖)。种子 LCG,纯前端确定性。
 */
function jitterPick<T>(arr: T[], n: number, seed: number, window: number): T[] {
  let s = seed % 233280 || 1;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return arr
    .map((x, i) => ({ x, k: i + rnd() * window }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.x)
    .slice(0, n);
}

export default function HomePage() {
  const router = useRouter();
  const { user, setLocale } = useAuth();
  // Phase 1 GPS 距离排序 · 进入 home 自动尝试获取(用户授权后 PATCH 给后端)
  // 拒绝过 24h 不再问 · 不阻塞 UI · 静默失败
  // 拿 status 用于顶部 chip 三态展示(定位中/成功/未定位)
  const gpsState = useGpsAutoUpload(true);
  // 筛选 + 语言 + 位置 + 语音助理 BottomSheet 开关
  const [filterOpen, setFilterOpen] = useState(false);
  const [localeOpen, setLocaleOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // 与 discover 全对齐的就地筛选:多选 chips + GPS 附近 + FilterDrawer 共享同一份 DiscoverFilters
  const [filters, setFilters] = useState<DiscoverFilters>(EMPTY_FILTERS);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // 客户对本机的历史访问次数(localStorage·零后端)→ 驱动 AI 智能匹配文案"了解程度"动态
  // null=首帧未知(避免闪错文案);读到的是"本次之前"的次数(0=首次)
  const [visits, setVisits] = useState<number | null>(null);
  // 通知红点 · 拉真实未读数
  const { unreadCount, mutate: mutateUnread } = useUnreadCount();

  // M05 Phase 2 · SSE 实时刷新 home Bell 红点(notification_new / unread_change)
  useServerEvents((event) => {
    if (event === 'notification_new' || event === 'unread_change') {
      void mutateUnread();
    }
  });
  // 位置偏好 · home chip 显示 + 切换时 mutate technicians list
  const { pref: locPref, mutate: mutateLocPref } = useLocationPref();

  // 未登录直接踢回首页 · SWR 加载完才检查会有 race,所以这里同步检查
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.localStorage.getItem('access_token')) router.replace('/');
  }, [router]);

  // 读+自增本机访问次数(读到的是本次之前的)→ AI 智能匹配文案动态
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prev = parseInt(window.localStorage.getItem('lr_home_visits') || '0', 10) || 0;
    setVisits(prev);
    window.localStorage.setItem('lr_home_visits', String(prev + 1));
  }, []);

  // 真 GPS · 取坐标 → 带 lat/lng 请求;失败优雅降级(同 discover enableNear)
  async function enableNear() {
    setNotice(null);
    setLocating(true);
    const r = await requestCoords();
    setLocating(false);
    if (r.ok) {
      setCoords({ lat: r.lat, lng: r.lng });
      setFilters((f) => ({ ...f, near: true }));
      return;
    }
    setNotice(r.reason === 'denied' ? '定位被拒绝 · 去筛选里选个城市,或在系统设置里允许定位' : '定位失败 · 去筛选里选个城市吧');
    setFilters((f) => ({ ...f, near: false }));
  }

  // 点顶部快捷 chip · toggle 到 filters(near 走 GPS 流程)
  function onChip(key: (typeof CHIPS)[number]['key']) {
    if (key === 'near') {
      if (filters.near) {
        setNotice(null);
        setFilters((f) => ({ ...f, near: false }));
      } else {
        void enableNear();
      }
      return;
    }
    setFilters((f) => toggleChip(key, f));
  }

  // SWR · key 由 DiscoverFilters 派生 → chips/抽屉一改就重拉,列表就地筛选
  // 不传 cityFallback:首页默认列表沿用后端个性化;limit=50(可下滑看更多·达阈值才显示"查看更多")
  const swrKey = `/therapists?${queryToString(buildQuery(filters, { coords, limit: 50, offset: 0 }))}`;
  const { data: rawList, error } = useSWR<ApiTherapist[]>(swrKey);
  const apiList = error ? [] : rawList ?? [];
  // 0027 · 公开 currencies 字典(home 卡片价格 fiat 显示)
  const { data: currencies } = useSWR<Array<{ code: string; symbol: string; decimals: number }>>('/currencies');
  // 小程序运营配置(后台可改 · 缺则回退硬编码 · 永不假装数据)
  const { data: appCfg } = useSWR<Record<string, unknown>>('/app-config');
  const promiseCfg = ((appCfg?.['home.promise'] as HomePromise) ?? HOME_PROMISE_FALLBACK);
  const footerCfg = ((appCfg?.['home.brandFooter'] as HomeFooter) ?? HOME_FOOTER_FALLBACK);
  // 真画像"了解程度"档(后端按 master 偏好+记忆深度算)· 以它为准,访问次数仅在未加载时兜底
  const { data: famData } = useSWR<{ familiarity: 0 | 1 | 2 }>('/me/ai-familiarity');
  // 个性化推荐 feed(接 recommend 引擎:亲密/偏好/在线/冷启动供给公平)· 失败/空 → 退回 cards 派生
  const recKey = `/me/recommendations?limit=16${locPref?.cityName ? `&city=${encodeURIComponent(locPref.cityName)}` : ''}`;
  const { data: recData } = useSWR<{ items: Array<{ id: string; name: string | null; img: string | null; city: string | null; height: number | null; score: string; online: boolean }> }>(recKey);
  // 每次进站轮换位置(防视觉疲劳)· 种子 mount 时定一次 → 本次访问稳定、下次不同
  const [rotSeed] = useState(() => Math.floor(Math.random() * 233280) + 1);
  const currenciesList = currencies ?? [];

  // 派生:cards / totalCount 用 useMemo,数据变就重算(在线优先用于 heroPicks 排序)
  const { cards, totalCount } = useMemo(() => {
    const _cards = apiList.map((tt, i) => apiToCard(tt, i, currenciesList));
    return {
      cards: _cards,
      totalCount: _cards.length,
    };
  }, [apiList, currenciesList]);

  // 顶部「AI 智能匹配」精选卡:优先用 recommend 引擎的个性化排序池;无则退回 cards 在线优先。
  // 再做"每次进站轮换位置"(rank 加权抖动:高分大概率靠前但位置每访问变,防视觉疲劳)→ 取 8。
  const heroPicks: HeroPick[] = useMemo(() => {
    let source: HeroPick[];
    if (recData?.items && recData.items.length > 0) {
      source = recData.items.map((r) => ({
        href: `/therapist/${r.id}`,
        img: r.img ?? '',
        name: r.name ?? '—',
        online: r.online,
        city: r.city ?? '',
        distance: '',
        highlight: r.height ? `${r.height}cm` : '',
        score: r.score,
      }));
    } else {
      const online = cards.filter((c) => c.badge.kind === 'online');
      const offline = cards.filter((c) => c.badge.kind !== 'online');
      source = [...online, ...offline].map((c) => ({
        href: c.href,
        img: c.img,
        name: c.cn,
        online: c.badge.kind === 'online',
        city: c.country,
        distance: c.distance,
        highlight: c.height ? `${c.height}cm` : c.langs,
        score: c.score,
      }));
    }
    return jitterPick(source, 8, rotSeed, 6);
  }, [recData, cards, rotSeed]);

  // 是否在筛选态:有任一 chip/抽屉条件激活 → 隐藏顶部精选卡、标题改"筛选结果"
  const filtering = countActiveFilters(filters) > 0 || !!filters.near;

  // 去重:默认态 hero 已展示的不在下方重复;并对"全部佳人"也做每访问洗牌(防疲劳)。
  const heroHrefs = new Set(heroPicks.map((p) => p.href));
  const gridCards = useMemo(() => {
    const base = filtering ? cards : cards.filter((c) => !heroHrefs.has(c.href));
    return filtering ? base : jitterPick(base, base.length, rotSeed ^ 0x5bd1, base.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, filtering, recData, rotSeed]);
  // 默认态若全部技师都已在 hero(供给少)→ 不渲染空的「全部佳人」区
  const showGrid = filtering || gridCards.length > 0;

  // AI 智能匹配文案"了解程度"动态:新客谦逊+引导填喜好,熟客自信(P0 按访问次数;真画像档待后端)
  // visits=null 首帧→中性档(不闪错);0=首次或没设城市→新客;1-3→渐熟;4+→熟客
  // 优先用后端真画像档;未加载时用访问次数代理兜底(避免首帧闪错)
  const visitTier = visits == null ? 1 : (visits <= 0 ? 0 : visits <= 3 ? 1 : 2);
  const familiarity: 0 | 1 | 2 = famData ? famData.familiarity : visitTier;
  const heroIntro: { subtitle: React.ReactNode; cta?: { text: string; href: string } } =
    familiarity === 0
      ? {
          subtitle: (
            <>第一次见你呀~ 还不太懂你的口味。<span className="font-medium text-[#E8546B]">跟我说说你喜欢什么型</span>,挑得更准 ✦</>
          ),
          cta: { text: '告诉小助理你的喜好', href: '/match' },
        }
      : familiarity === 1
        ? { subtitle: <>正在慢慢懂你~ 这几位先看看,<span className="font-medium text-[#E8546B]">多聊两句我更准</span> ✦</> }
        : { subtitle: <>小助理懂你的喜好,<span className="font-medium text-[#E8546B]">为你精挑了这几位</span> ✦</> };

  // 筛选 chips 行(复用)。⚠️ min-h 必须有:overflow-x-auto 会连带 overflow-y 把行高塌成只剩 padding
  //   → 药丸被纵向裁(生产实测回归过两次)。显式 min-h + items-center 让药丸取自然高度居中、横滑不变;
  //   pt-2 给 nav 下方留呼吸,pb-3 与下方区块分隔。
  const chipsRow = (
    <div className="no-scrollbar flex items-center gap-2.5 overflow-x-auto px-4 pt-2 pb-3 min-h-[3.5rem]">
      {CHIPS.filter((c) => c.key !== 'online').map((c) => {
        const active = isChipActive(c.key, filters);
        const isNear = c.key === 'near';
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChip(c.key)}
            disabled={isNear && locating}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium shadow-warm-sm backdrop-blur transition active:scale-95 disabled:opacity-60 ${
              active ? 'bg-gradient-cta text-white' : 'bg-white/90 text-ink-700'
            }`}
          >
            {isNear && (
              <Navigation className={`h-3 w-3 ${locating ? 'animate-pulse' : ''} ${active ? 'text-white' : 'text-rose-500'}`} />
            )}
            {c.dot && <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : 'bg-emerald-500'}`} />}
            <span>{isNear && locating ? '定位中…' : c.label}</span>
            {c.sub && <span className="text-[10px] opacity-80">{c.sub}</span>}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setFilterOpen(true)}
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium shadow-warm-sm backdrop-blur transition active:scale-95 ${
          countActiveFilters(filters) > 0 ? 'bg-ink-900 text-white' : 'bg-white/90 text-ink-700'
        }`}
        aria-label="打开筛选"
      >
        <SlidersHorizontal className="h-3 w-3" />
        <span>筛选</span>
        {countActiveFilters(filters) > 0 && (
          <span className="ml-0.5 rounded-full bg-white px-1 text-[9px] font-bold text-rose-600">
            {countActiveFilters(filters)}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div className="mobile-container">
      {/* === 顶部 Nav === */}
      <nav className="sticky top-0 z-50 nav-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 fade-up">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center heart-logo flex-shrink-0">
              <Heart className="w-4 h-4 text-white fill-white" />
            </div>
            <button
              className="loc-chip max-w-[180px]"
              type="button"
              onClick={() => setLocOpen(true)}
              aria-label="位置/切换"
            >
              {locPref?.cityName ? (
                <>
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-[#FF5577]" />
                  <span className="font-serif-cn text-[12px] font-medium text-[#1A1A2E] whitespace-nowrap truncate">
                    {locPref.cityName}
                  </span>
                </>
              ) : gpsState.status === 'idle' || gpsState.status === 'requesting' ? (
                <>
                  <MapPin className="w-3.5 h-3.5 shrink-0 animate-pulse text-[#FF5577]" />
                  <span className="font-serif-cn text-[12px] font-medium text-ink-500 whitespace-nowrap">
                    定位中…
                  </span>
                </>
              ) : (
                <>
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-ink-400" />
                  <span className="font-serif-cn text-[12px] font-medium text-ink-500 whitespace-nowrap">
                    {gpsState.status === 'denied' ? '开启定位' : '设置位置'}
                  </span>
                </>
              )}
              <ChevronDown className="w-3 h-3 shrink-0 text-[#6A7088]" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/search" className="nav-btn-light" aria-label="搜索">
              <Search className="w-3.5 h-3.5 text-[#1A1A2E]" />
            </Link>
            <button type="button" className="nav-btn-light" onClick={() => setLocaleOpen(true)} aria-label="切换语言">
              <Globe className="w-3.5 h-3.5 text-[#1A1A2E]" />
            </button>
            <Link href="/me/notifications" className="nav-btn-light" aria-label="通知">
              <Bell className="w-3.5 h-3.5 text-[#1A1A2E]" />
              {unreadCount > 0 && <span className="dot"></span>}
            </Link>
          </div>
        </div>
      </nav>

      {/* === 快捷筛选行 · 始终在内容上方(筛选逻辑/FilterDrawer 不变,只换样式;首页不显示在线项) === */}
      {chipsRow}

      {/* === AI 智能匹配 · 沉浸式精选大图(横滑 · 心动焦点层)· 筛选态隐藏 === */}
      {!filtering && (
        <HeroPicksCarousel
          picks={heroPicks}
          subtitle={heroIntro.subtitle}
          cta={heroIntro.cta}
          onPrefetch={(href) => {
            const tid = href.split('/').pop();
            if (tid) void swrMutate(`/therapists/${tid}`);
          }}
        />
      )}

      {/* 定位降级提示(与 discover 同款样式) */}
      {notice && (
        <div className="mx-4 mt-2 rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-[12px] text-warm-700">
          {notice}
        </div>
      )}

      {/* M02b/M04 Phase 1 · 今晚特惠节目 banner(未来 24h 内的 open shows) */}
      <TonightShowsBanner />

      {/* 筛选抽屉(与 discover 同款 · 与 chips 共享 DiscoverFilters · 就地应用) */}
      <FilterDrawer
        isOpen={filterOpen}
        initial={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => setFilters({ ...next, near: filters.near })}
      />

      {/* 语言切换 BottomSheet */}
      <LocaleSheet
        isOpen={localeOpen}
        current={(user?.locale as LocaleCode) ?? 'zh'}
        onClose={() => setLocaleOpen(false)}
        onSelect={(l) => void setLocale(l)}
      />

      {/* 位置切换 BottomSheet */}
      <LocationSheet
        isOpen={locOpen}
        currentCityId={locPref?.cityId ?? null}
        currentAreaId={locPref?.areaId ?? null}
        onClose={() => setLocOpen(false)}
        onSelect={async ({ cityId, areaId }) => {
          await setLocationPref({ cityId, areaId, source: 'manual' });
          await mutateLocPref();
          // 让首页技师列表重拉 · personalize 个性化用新位置(当前筛选 key)
          void swrMutate(swrKey);
        }}
      />

      {/* 旧静态「今夜独宠」单图 hero 已被顶部横滑精选卡取代(见 nav 下方 HeroPicksCarousel) */}

      {/* === 章节标题(默认"全部佳人"/筛选"筛选结果";hero 已展示的不在此重复) === */}
      {showGrid && (
      <section className="px-4 pt-4 pb-2 flex items-end justify-between">
        <div>
          <div className="section-sub mb-1">{filtering ? `Results · ${totalCount}` : `All · ${gridCards.length}`}</div>
          <h2 className="serif-cn text-[19px] font-semibold text-[#1A1614] leading-tight">{filtering ? '筛选结果' : '全部佳人'}</h2>
        </div>
        {filtering && (
          <button
            className="flex items-center gap-1 text-xs text-[#6A7088] font-medium"
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setNotice(null);
            }}
          >
            <X className="w-3.5 h-3.5" />
            <span>清空</span>
          </button>
        )}
      </section>
      )}

      {/* 筛选无结果空态(与 discover 同口径) */}
      {filtering && !error && gridCards.length === 0 && (
        <div className="mx-4 mt-2 rounded-2xl border border-dashed border-warm-200 bg-white/60 px-6 py-12 text-center backdrop-blur-sm">
          <div className="text-4xl">🌸</div>
          <div className="mt-3 font-serif-cn text-[15px] font-semibold text-ink-800">没有符合的技师</div>
          <div className="mt-1.5 text-[12px] text-ink-500">放宽筛选或换个条件试试</div>
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setNotice(null);
            }}
            className="mt-4 inline-flex items-center rounded-full bg-gradient-cta px-5 py-2 text-[12.5px] font-medium text-white shadow-rose-md active:scale-95"
          >
            清空筛选
          </button>
        </div>
      )}

      {/* === 全部佳人 · 统一 2 列卡(图上 + 白底信息区,字段同当前;hero 已展示的不重复)=== */}
      {showGrid && (
      <section className="grid grid-cols-2 gap-3.5 px-4">
        {gridCards.map((c, i) => {
          // 卡片悬停/触摸瞬间预取详情(0ms 进详情,见原瀑布流注释)
          const tid = c.href.split('/').pop();
          const prefetchApi = () => {
            if (tid) void swrMutate(`/therapists/${tid}`);
          };
          return (
          <Link
            key={i}
            href={c.href}
            prefetch={true}
            onPointerEnter={prefetchApi}
            onTouchStart={prefetchApi}
            className="flex flex-col overflow-hidden rounded-2xl border border-[#ECE7E3] bg-white shadow-warm-sm transition active:scale-[0.99] animate-fade-up"
            style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
          >
            <div className="relative aspect-[4/5] bg-ink-100">
              {c.img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.img} alt={c.cn} className="h-full w-full object-cover object-[center_18%]" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-cta">
                  <span className="serif-cn text-4xl font-semibold text-white/90">{c.cn.slice(0, 1)}</span>
                </div>
              )}
            </div>
            <div className="px-2.5 pb-2.5 pt-2">
              <div className="flex items-center justify-between gap-1.5">
                <span className="serif-cn truncate text-[15.5px] font-semibold text-[#1A1614]">{c.cn}</span>
                <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-[#1A1614]">
                  <Star className="h-3 w-3 fill-[#F5A623] text-[#F5A623]" />{c.score}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-[#8A817C]">
                {c.age > 0 ? `${c.age} · ` : ''}{c.height > 0 ? `${c.height}cm · ` : ''}{c.country}{c.distance ? ` · ${c.distance}` : ''}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className="rounded-md bg-[#F4F0ED] px-1.5 py-0.5 text-[10px] text-[#8A817C]">{c.langs}</span>
                {c.type && <span className="rounded-md bg-[#F4F0ED] px-1.5 py-0.5 text-[10px] text-[#8A817C]">{c.type}</span>}
                {serviceModeLabel(c.serviceMode) && (
                  <span className="rounded-md bg-[#F4F0ED] px-1.5 py-0.5 text-[10px] text-[#8A817C]">{serviceModeLabel(c.serviceMode)}</span>
                )}
              </div>
              <div className="mt-2 flex items-end justify-between">
                <span className="font-bold text-[#E8546B]">
                  <span className="text-[10px] font-semibold">{c.currency}</span>
                  <span className="num text-[14.5px]">{c.price}</span>
                  <span className="text-[10px] font-medium text-[#8A817C]">{c.unit}</span>
                </span>
                <span className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-[#E8546B]">约 <ArrowRight className="h-2.5 w-2.5" /></span>
              </div>
            </div>
          </Link>
          );
        })}
      </section>
      )}

      {/* === 加载更多(可见技师 ≥50 才显示) === */}
      {totalCount >= 50 && (
        <section className="px-4 pt-2 pb-4">
          <Link
            href="/discover"
            className="w-full py-3 rounded-full flex items-center justify-center gap-2 text-[12px] font-medium tracking-wider transition-all hover:shadow-md"
            style={{ background: 'white', border: '1px solid rgba(255, 138, 122, 0.2)', color: '#FF5577' }}
          >
            <ChevronUp className="w-3.5 h-3.5 rotate-180" />
            <span>看看全部 · 总有一位让你心跳</span>
          </Link>
        </section>
      )}

      {/* === 承诺区 === */}
      <section className="px-4 pt-4 pb-2">
        <div className="text-center mb-3">
          <div className="section-sub mb-1">{promiseCfg.subtitle}</div>
          <h2 className="section-h">{promiseCfg.title}</h2>
        </div>
        <div className="space-y-2">
          <div className="promise-row">
            <div className="promise-icon-box" style={{ background: 'linear-gradient(135deg, #F0F4FF, #E5EEFF)' }}>
              <Languages className="w-4 h-4 text-[#FF8A7A]" />
            </div>
            <div className="flex-1 leading-snug">
              <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">{promiseCfg.items[0]?.title ?? HOME_PROMISE_FALLBACK.items[0]!.title}</div>
              <div className="text-[10px] text-[#6A7088]">{promiseCfg.items[0]?.sub ?? HOME_PROMISE_FALLBACK.items[0]!.sub}</div>
            </div>
          </div>
          <div className="promise-row">
            <div className="promise-icon-box" style={{ background: 'linear-gradient(135deg, #E5F8EE, #D5F4E3)' }}>
              <Sparkles className="w-4 h-4 text-[#2DCE89]" />
            </div>
            <div className="flex-1 leading-snug">
              <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">{promiseCfg.items[1]?.title ?? HOME_PROMISE_FALLBACK.items[1]!.title}</div>
              <div className="text-[10px] text-[#6A7088]">{promiseCfg.items[1]?.sub ?? HOME_PROMISE_FALLBACK.items[1]!.sub}</div>
            </div>
          </div>
          <div className="promise-row">
            <div className="promise-icon-box" style={{ background: 'linear-gradient(135deg, #FFF3E0, #FFE0CC)' }}>
              <ShieldCheck className="w-4 h-4 text-[#FFB347]" />
            </div>
            <div className="flex-1 leading-snug">
              <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">{promiseCfg.items[2]?.title ?? HOME_PROMISE_FALLBACK.items[2]!.title}</div>
              <div className="text-[10px] text-[#6A7088]">{promiseCfg.items[2]?.sub ?? HOME_PROMISE_FALLBACK.items[2]!.sub}</div>
            </div>
          </div>
        </div>
      </section>

      {/* === 品牌脚注 === */}
      <section className="px-5 pt-6 pb-28 text-center">
        <div className="font-cormorant italic text-[10px] text-[#6A7088]/40 tracking-[0.4em] mb-1.5">— {footerCfg.wordmark} —</div>
        <div className="font-serif-cn text-[9px] text-[#6A7088]/30 tracking-[0.3em]">{footerCfg.tagline}</div>
      </section>

      {/* === 底部 nav · AI fab 中央浮起 === */}
      <nav className="sticky bottom-0 z-30 mt-auto shrink-0 bottom-nav">
        <div className="px-3 pt-3 pb-2 relative">
          <div className="grid grid-cols-5 items-end">
            <Link href="/home" className="flex flex-col items-center gap-0.5 py-1">
              <Compass className="w-5 h-5 text-[#FF5577]" />
              <span className="text-[9px] text-[#FF5577] font-medium mt-0.5">发现</span>
            </Link>
            <Link href="/conversations" className="flex flex-col items-center gap-0.5 py-1">
              <MessageCircle className="w-5 h-5 text-[#6A7088]" />
              <span className="text-[9px] text-[#6A7088] mt-0.5">私聊</span>
            </Link>
            <div className="flex flex-col items-center relative">
              {/* v5 · 中央"助理"按钮触发 VoiceAssistantSheet · 不跳页 */}
              <button
                type="button"
                onClick={() => setVoiceOpen(true)}
                className="ai-fab relative w-14 h-14 rounded-full flex items-center justify-center text-white -mt-7"
                aria-label="语音助理"
              >
                <Sparkles className="w-6 h-6" />
              </button>
              <span className="text-[9px] text-[#FF8A7A] mt-1 tracking-wider font-medium">助理</span>
            </div>
            <Link href="/order" className="flex flex-col items-center gap-0.5 py-1">
              <Calendar className="w-5 h-5 text-[#6A7088]" />
              <span className="text-[9px] text-[#6A7088] mt-0.5">预约</span>
            </Link>
            <Link href="/me" className="flex flex-col items-center gap-0.5 py-1">
              <User className="w-5 h-5 text-[#6A7088]" />
              <span className="text-[9px] text-[#6A7088] mt-0.5">我的</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* v5 · 语音助理 sheet · 中央按钮触发 · 不跳页 */}
      <VoiceAssistantSheet isOpen={voiceOpen} onClose={() => setVoiceOpen(false)} city={locPref?.cityName ?? null} />
    </div>
  );
}

// M02b/M04 Phase 1 · 今晚特惠 shows banner · 拉未来 24h 内的 open 节目
interface ShowCard {
  id: string;
  category_code: string;
  category_name_zh: string | null;
  category_icon_emoji: string | null;
  start_time: string;
  duration_min: number;
  price_points: number;
  slots_total: number;
  slots_remaining: number;
  service_city: string | null;
  therapist_display_name: string | null;
  therapist_avatar_url: string | null;
}

function TonightShowsBanner() {
  const [shows, setShows] = useState<ShowCard[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const now = new Date();
        const end = new Date(now.getTime() + 24 * 3600 * 1000);
        const data = await apiGet<ShowCard[]>('/shows', {
          from: now.toISOString(),
          to: end.toISOString(),
          limit: 5,
        });
        setShows(data);
      } catch {
        // 静默 · banner 不显示 home 仍可用
      }
    })();
  }, []);

  if (shows.length === 0) return null;

  return (
    <section className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[14px] font-semibold text-ink-800 text-serif-cn">🎫 今晚特惠</h2>
        <span className="text-[10px] text-ink-500">{shows.length} 场 · 未来 24h</span>
      </div>
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 scrollbar-hide">
        {shows.map((s) => {
          const d = new Date(s.start_time);
          const hh = d.getHours().toString().padStart(2, '0');
          const mm = d.getMinutes().toString().padStart(2, '0');
          return (
            <Link
              key={s.id}
              href={`/shows/${s.id}`}
              className="flex-shrink-0 w-[160px] rounded-2xl overflow-hidden bg-white border border-warm-100 shadow-warm-xs active:scale-[0.98]"
            >
              <div className="relative h-[120px] bg-gradient-warm-rose">
                {s.therapist_avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.therapist_avatar_url} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 25%' }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent" />
                <div className="absolute top-2 left-2 rounded-full bg-white/30 backdrop-blur px-1.5 py-0.5 text-[9px] text-white">
                  {s.category_icon_emoji} {s.category_name_zh ?? s.category_code}
                </div>
                {s.slots_remaining <= 2 && (
                  <div className="absolute top-2 right-2 rounded-full bg-danger-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    剩 {s.slots_remaining}
                  </div>
                )}
                <div className="absolute bottom-2 left-2 right-2 text-white">
                  <div className="text-[11px] font-semibold truncate">{s.therapist_display_name ?? '神秘技师'}</div>
                  <div className="text-[10px] opacity-90">{hh}:{mm} · {s.duration_min}分钟</div>
                </div>
              </div>
              <div className="px-2.5 py-2 flex items-center justify-between">
                <div className="text-[10px] text-ink-500">{s.service_city ?? '—'}</div>
                <div className="text-[13px] font-bold text-primary">{s.price_points}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
