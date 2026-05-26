'use client';

import { useEffect, useState } from 'react';
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
  ArrowUpDown,
  Languages,
  ShieldCheck,
  SlidersHorizontal,
  Ruler,
  Wallet,
  Check,
  ChevronUp,
} from 'lucide-react';
import { apiGet } from '@/lib/api';

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
}

const PROTO_FALLBACK: CardData[] = [
  { href: '#', cn: '薇薇', en: 'Vivi',    age: 25, height: 165, country: '泰国',     langs: '中',       type: '油压', currency: '฿',  price: '900',   unit: '/90min', img: '/proto-images/t-1.png',  imgPos: 'center 30%', heightCls: 'h-tall',  badge: { kind: 'online', text: '今晚在线' }, score: '9.5', distance: '1.8km' },
  { href: '#', cn: '娜娜', en: 'Nana',    age: 22, height: 170, country: '清迈',     langs: '中/英/泰', type: '泰式', currency: '฿',  price: '1,500', unit: '/120',   img: '/proto-images/t-4.png',  imgPos: 'center 20%', heightCls: 'h-short', badge: { kind: 'vip',    text: 'VIP' },    score: '9.8', distance: '2.7km' },
  { href: '#', cn: '美樱', en: 'Mei',     age: 21, height: 166, country: '曼谷',     langs: '中/泰',    type: 'SPA',  currency: '฿',  price: '950',   unit: '/90',    img: '/proto-images/t-14.png', imgPos: 'center 25%', heightCls: 'h-short', badge: { kind: 'online', text: '今晚在线' }, score: '9.2', distance: '2.5km' },
  { href: '#', cn: '林夕', en: 'Lin Xi',  age: 24, height: 163, country: '新加坡',   langs: '中文',     type: '中医', currency: 'S$', price: '180',   unit: '/60',    img: '/proto-images/t-11.png', imgPos: 'center 25%', heightCls: 'h-tall',  badge: { kind: 'online', text: '今晚在线' }, score: '9.4', distance: '3.1km' },
  { href: '#', cn: '安琪', en: 'Angel',   age: 23, height: 167, country: '巴厘岛',   langs: '中/英',    type: 'SPA',  currency: '฿',  price: '1,100', unit: '/90',    img: '/proto-images/t-7.png',  imgPos: 'center 30%', heightCls: 'h-mid',   badge: { kind: 'online', text: '刚刚上线' }, score: '9.7', distance: '4.1km' },
  { href: '#', cn: '朵朵', en: 'Duo',     age: 22, height: 164, country: '曼谷',     langs: '中文',     type: '泰式', currency: '฿',  price: '850',   unit: '/90',    img: '/proto-images/t-9.png',  imgPos: 'center 20%', heightCls: 'h-mid',   badge: { kind: 'online', text: '今晚在线' }, score: '9.3', distance: '3.5km' },
  { href: '#', cn: '雅雅', en: 'Yaya',    age: 24, height: 169, country: '普吉',     langs: '中/英/泰', type: '油压', currency: '฿',  price: '1,200', unit: '/90',    img: '/proto-images/t-12.png', imgPos: 'center 25%', heightCls: 'h-short', badge: { kind: 'vip',    text: 'HOT' },    score: '9.5', distance: '6.8km' },
  { href: '#', cn: '樱花', en: 'Sakura',  age: 23, height: 165, country: '曼谷',     langs: '中/日',    type: 'SPA',  currency: '฿',  price: '1,300', unit: '/90',    img: '/proto-images/t-8.png',  imgPos: 'center 25%', heightCls: 'h-tall',  badge: { kind: 'online', text: '今晚在线' }, score: '9.6', distance: '2.9km' },
  { href: '#', cn: '蜜糖', en: 'Mitang',  age: 22, height: 162, country: '吉隆坡',   langs: '中文',     type: '泰式', currency: 'RM', price: '280',   unit: '/90',    img: '/proto-images/t-6.png',  imgPos: 'center 25%', heightCls: 'h-mid',   badge: { kind: 'online', text: '今晚在线' }, score: '9.4', distance: '4.2km' },
  { href: '#', cn: '璐璐', en: 'Lulu',    age: 25, height: 168, country: '芭提雅',   langs: '中/英',    type: 'SPA',  currency: '฿',  price: '1,000', unit: '/90',    img: '/proto-images/t-10.png', imgPos: 'center 25%', heightCls: 'h-mid',   badge: { kind: 'online', text: '今晚在线' }, score: '9.5', distance: '5.5km' },
  { href: '#', cn: '雨萱', en: 'Yuxuan',  age: 23, height: 166, country: '曼谷',     langs: '中文',     type: 'cos',  currency: '฿',  price: '950',   unit: '/90',    img: '/proto-images/t-5.png',  imgPos: 'center 20%', heightCls: 'h-short', badge: { kind: 'vip',    text: 'NEW' },    score: '9.3', distance: '2.1km' },
  { href: '#', cn: '思思', en: 'Sisi',    age: 24, height: 170, country: '河内',     langs: '中/英',    type: '泰式', currency: '฿',  price: '1,100', unit: '/90',    img: '/proto-images/t-13.png', imgPos: 'center 25%', heightCls: 'h-tall',  badge: { kind: 'online', text: '今晚在线' }, score: '9.6', distance: '3.8km' },
];

const HEIGHTS = ['h-tall', 'h-mid', 'h-short', 'h-tall', 'h-mid', 'h-mid', 'h-short', 'h-tall', 'h-mid', 'h-mid', 'h-short', 'h-tall'] as const;

function apiToCard(t: ApiTherapist, idx: number): CardData {
  const score = ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
  const tiers = (Array.isArray(t.basePriceJson) ? t.basePriceJson : []) as Array<{ duration: number; pricePoints: number }>;
  const first = tiers[0];
  const price = first ? first.pricePoints.toLocaleString() : '—';
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
    currency: '积',
    price,
    unit,
    img: t.avatarUrl ?? PROTO_FALLBACK[idx % 12]!.img,
    imgPos: 'center 25%',
    heightCls: HEIGHTS[idx % HEIGHTS.length]!,
    badge: t.onlineStatus === 'online' ? { kind: 'online', text: '今晚在线' } : { kind: 'vip', text: 'HOT' },
    score,
    distance: `${(2 + idx * 0.3).toFixed(1)}km`,
  };
}

export default function HomePage() {
  const router = useRouter();
  const [cards, setCards] = useState<CardData[]>(PROTO_FALLBACK);
  const [onlineCount, setOnlineCount] = useState(248);
  const [totalCount, setTotalCount] = useState(1892);

  useEffect(() => {
    const t = window.localStorage.getItem('access_token');
    if (!t) {
      router.replace('/');
      return;
    }
    void (async () => {
      try {
        const res = await apiGet<{ data: ApiTherapist[]; meta?: { total: number } }>('/therapists?limit=20');
        const apiCards = (res.data ?? []).map((tt, i) => apiToCard(tt, i));
        if (apiCards.length > 0) {
          // 拼接 API 卡 + prototype fallback 补满 12 张视觉
          const merged = [...apiCards];
          for (let i = apiCards.length; i < 12 && i < PROTO_FALLBACK.length; i++) {
            merged.push(PROTO_FALLBACK[i]!);
          }
          setCards(merged);
          setOnlineCount(apiCards.filter(c => c.badge.kind === 'online').length || 248);
          setTotalCount(res.meta?.total ?? 1892);
        }
      } catch {
        // 保留 fallback
      }
    })();
  }, [router]);

  const featured = cards[0];

  return (
    <div className="mobile-container">
      {/* === 顶部 Nav === */}
      <nav className="sticky top-0 z-50 nav-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 fade-up">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center heart-logo flex-shrink-0">
              <Heart className="w-4 h-4 text-white fill-white" />
            </div>
            <button className="loc-chip" type="button">
              <MapPin className="w-3.5 h-3.5 text-[#FF5577]" />
              <span className="font-serif-cn text-[12px] font-medium text-[#1A1A2E]">曼谷 · Asok</span>
              <ChevronDown className="w-3 h-3 text-[#6A7088]" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="#" className="nav-btn-light">
              <Globe className="w-3.5 h-3.5 text-[#1A1A2E]" />
            </Link>
            <Link href="#" className="nav-btn-light">
              <Bell className="w-3.5 h-3.5 text-[#1A1A2E]" />
              <span className="dot"></span>
            </Link>
          </div>
        </div>
      </nav>

      {/* === 主标语 === */}
      <section className="px-5 pt-3 pb-3">
        <div className="fade-up delay-1">
          <p className="font-cormorant italic text-[10px] text-[#FF5577] tracking-[0.3em] uppercase mb-1.5">Find the Right One with AI</p>
          <h1 className="font-serif-cn text-[24px] font-semibold leading-[1.25] text-[#1A1A2E]">
            今晚，<span className="shimmer">谁来温柔你</span>？
          </h1>
        </div>
      </section>

      {/* === 搜索框 === */}
      <section className="px-4 pb-2 fade-up delay-2">
        <div className="search-bar">
          <Search className="w-4 h-4 text-[#9A9FB5]" />
          <input type="text" placeholder="试试「曼谷 · 165cm · 中文」" />
          <button className="w-7 h-7 rounded-lg flex items-center justify-center" type="button" style={{ background: 'linear-gradient(135deg, #FF8A7A, #FF5577)' }}>
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </section>

      {/* === 在线数据条 === */}
      <div className="stats-bar pt-3 pb-1 fade-up delay-2">
        <div className="stats-item">
          <span className="pulse-dot"></span>
          <span className="num-big num">{onlineCount}</span>
          <span>位 · 在线等你</span>
        </div>
        <div className="stats-item">
          <Heart className="w-3 h-3 text-[#FF5577]" />
          <span className="num-big num">{totalCount.toLocaleString()}</span>
          <span>位绝色佳人</span>
        </div>
        <div className="stats-item">
          <Check className="w-3 h-3 text-[#2DCE89]" />
          <span>今晚见</span>
        </div>
      </div>

      {/* === 筛选 chips === */}
      <div className="filter-wrap mt-2">
        <div className="filter-scroll">
          <button className="chip active" type="button">
            <MapPin className="w-3 h-3" />
            <span>附近</span>
            <span className="text-[10px] opacity-80">3km</span>
          </button>
          <button className="chip" type="button">
            <Languages className="w-3 h-3" />
            <span>语言</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
          <button className="chip" type="button">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2DCE89]"></span>
            <span>今晚可约</span>
          </button>
          <button className="chip" type="button">
            <Star className="w-3 h-3" />
            <span>9 分天花板</span>
          </button>
          <button className="chip" type="button">
            <Ruler className="w-3 h-3" />
            <span>165cm+</span>
          </button>
          <button className="chip" type="button">
            <Wallet className="w-3 h-3" />
            <span>&lt; ฿1000</span>
          </button>
          <button className="chip" type="button"><span>泰式</span></button>
          <button className="chip" type="button"><span>油压</span></button>
          <button className="chip" type="button"><span>SPA</span></button>
          <button className="chip" type="button"><span>中医</span></button>
        </div>
        <button className="filter-fab" type="button">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>筛选</span>
          <span className="fab-dot"></span>
        </button>
      </div>

      {/* === 今日精选 banner === */}
      {featured && (
        <section className="px-4 pt-3 pb-2 fade-up delay-3">
          <Link href={featured.href} className="hero-banner block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={featured.img} alt={featured.cn} style={{ objectPosition: featured.imgPos }} />
            <div className="overlay"></div>
            <div className="absolute top-3 left-3">
              <span className="editor-pick inline-flex items-center gap-1">
                <Star className="w-3 h-3 fill-[#FF5577] text-[#FF5577]" />
                今夜独宠 · 仅 1 位
              </span>
            </div>
            <div className="sticky bottom-0 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-serif-cn text-[20px] font-semibold text-white">{featured.cn}</span>
                    {featured.en && <span className="font-display italic text-[13px] text-white/85">{featured.en}</span>}
                    <span className="text-[10px] text-white/70 ml-1">
                      · {featured.height}cm · {featured.langs}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-white/80">
                    <MapPin className="w-3 h-3" />
                    <span>{featured.country} · {featured.distance}</span>
                    <span className="mx-1">·</span>
                    <Star className="w-3 h-3 fill-[#FFB347] text-[#FFB347]" />
                    <span>{featured.score}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-white/85 font-cormorant italic">
                  <Heart className="w-3 h-3 fill-white" />
                  <span>EDITOR'S PICK</span>
                </div>
              </div>
            </div>
          </Link>
        </section>
      )}

      {/* === 章节标题 === */}
      <section className="px-4 pt-4 pb-2 flex items-end justify-between">
        <div>
          <div className="section-sub mb-1">Picked for You · AI · {totalCount}</div>
          <h2 className="section-h">为你心选</h2>
        </div>
        <button className="flex items-center gap-1 text-xs text-[#6A7088] font-medium" type="button">
          <ArrowUpDown className="w-3.5 h-3.5" />
          <span>离你最近</span>
        </button>
      </section>

      {/* === 技师瀑布流 === */}
      <section className="masonry mt-1">
        {cards.map((c, i) => (
          <Link key={i} href={c.href} className="therapist-card">
            <div className={`img-wrap ${c.heightCls}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.img} alt={c.cn} style={{ objectPosition: c.imgPos }} />
              {c.badge.kind === 'online' ? (
                <span className="badge-online">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2DCE89] animate-pulse"></span>
                  {c.badge.text}
                </span>
              ) : (
                <span className="badge-vip">{c.badge.text}</span>
              )}
              <span className="badge-score">
                <Star className="w-2.5 h-2.5 fill-[#FFB347] text-[#FFB347]" />
                <span className="val num">{c.score}</span>
              </span>
              <span className="badge-distance">
                <MapPin className="w-2.5 h-2.5" />
                {c.distance}
              </span>
            </div>
            <div className="card-body">
              <div className="card-name">
                <span className="cn">{c.cn}</span>
                {c.en && <span className="en">{c.en}</span>}
              </div>
              <div className="card-meta">
                {c.age > 0 && `${c.age} · `}{c.height > 0 && `${c.height}cm · `}{c.country}
              </div>
              <div className="card-tags">
                <span className="mini-tag lang">{c.langs}</span>
                <span className="mini-tag type">{c.type}</span>
              </div>
              <div className="card-bottom">
                <div className="card-price">
                  <span className="currency">{c.currency}</span>
                  <span className="val num">{c.price}</span>
                  <span className="unit">{c.unit}</span>
                </div>
                <span className="book-mini">心动 <ArrowRight className="w-2.5 h-2.5" /></span>
              </div>
            </div>
          </Link>
        ))}
      </section>

      {/* === 加载更多 === */}
      <section className="px-4 pt-2 pb-4">
        <Link
          href="/discover"
          className="w-full py-3 rounded-full flex items-center justify-center gap-2 text-[12px] font-medium tracking-wider transition-all hover:shadow-md"
          style={{ background: 'white', border: '1px solid rgba(255, 138, 122, 0.2)', color: '#FF5577' }}
        >
          <ChevronUp className="w-3.5 h-3.5 rotate-180" />
          <span>再看 {(totalCount - 12).toLocaleString()} 位 · 总有一位让你心跳</span>
        </Link>
      </section>

      {/* === 承诺区 === */}
      <section className="px-4 pt-4 pb-2">
        <div className="text-center mb-3">
          <div className="section-sub mb-1">Why LoveRush</div>
          <h2 className="section-h">28,000+ 男人的私选</h2>
        </div>
        <div className="space-y-2">
          <div className="promise-row">
            <div className="promise-icon-box" style={{ background: 'linear-gradient(135deg, #F0F4FF, #E5EEFF)' }}>
              <Languages className="w-4 h-4 text-[#FF8A7A]" />
            </div>
            <div className="flex-1 leading-snug">
              <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">语言不通也能撩</div>
              <div className="text-[10px] text-[#6A7088]">中/英/泰/越/马/印 · 实时翻译</div>
            </div>
          </div>
          <div className="promise-row">
            <div className="promise-icon-box" style={{ background: 'linear-gradient(135deg, #E5F8EE, #D5F4E3)' }}>
              <Sparkles className="w-4 h-4 text-[#2DCE89]" />
            </div>
            <div className="flex-1 leading-snug">
              <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">越用越懂你的口味</div>
              <div className="text-[10px] text-[#6A7088]">第 2 次起精准命中 · 不走弯路</div>
            </div>
          </div>
          <div className="promise-row">
            <div className="promise-icon-box" style={{ background: 'linear-gradient(135deg, #FFF3E0, #FFE0CC)' }}>
              <ShieldCheck className="w-4 h-4 text-[#FFB347]" />
            </div>
            <div className="flex-1 leading-snug">
              <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">绝对隐身 · 谁也不知道</div>
              <div className="text-[10px] text-[#6A7088]">分级隐私 · 计算器伪装 · 一键隐身</div>
            </div>
          </div>
        </div>
      </section>

      {/* === 品牌脚注 === */}
      <section className="px-5 pt-6 pb-28 text-center">
        <div className="font-cormorant italic text-[10px] text-[#6A7088]/40 tracking-[0.4em] mb-1.5">— LOVERUSH —</div>
        <div className="font-serif-cn text-[9px] text-[#6A7088]/30 tracking-[0.3em]">东南亚 · 男人的私选清单</div>
      </section>

      {/* === 底部 nav · AI fab 中央浮起 === */}
      <nav className="sticky bottom-0 z-30 bottom-nav">
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
              <Link href="/assistant" className="ai-fab relative w-14 h-14 rounded-full flex items-center justify-center text-white -mt-7">
                <Sparkles className="w-6 h-6" />
              </Link>
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
    </div>
  );
}
