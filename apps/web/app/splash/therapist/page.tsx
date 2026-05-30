'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Heart, Sparkles, ArrowRight, Wallet, EyeOff, TrendingUp } from 'lucide-react';

/**
 * 技师启动页 · 1:1 port from v1/prototypes/splash-therapist.html
 * 4 页横向 swipe:被看见 → 被尊重 → 被守护 → 行动
 * 玫红主题(#B8398C),区别于客户端暖橙粉
 */

const TOTAL = 4;
const PAGE_WIDTH = 390;

const DEFAULT_SPLASH_IMAGES = [
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=500&h=900&fit=crop&q=85',
  'https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=500&h=900&fit=crop&q=85',
  'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=500&h=900&fit=crop&q=85',
  'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=500&h=900&fit=crop&q=85',
];

interface SplashConfig {
  scope: string;
  images: string[];
}

export default function TherapistSplashPage() {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  // admin 可在后台 /splash 配置技师启动页图片 · 拿不到时降级 Unsplash 默认
  const { data: splashConfig } = useSWR<SplashConfig>('/splash/config?scope=therapist');
  const imgs = splashConfig?.images && splashConfig.images.length > 0
    ? splashConfig.images
    : DEFAULT_SPLASH_IMAGES;
  const img = (i: number) => imgs[i] ?? DEFAULT_SPLASH_IMAGES[i] ?? DEFAULT_SPLASH_IMAGES[0]!;

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const onScroll = () => {
      const p = Math.round(el.scrollLeft / PAGE_WIDTH);
      setCurrent(p);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const nextPage = () => {
    pagesRef.current?.scrollTo({ left: (current + 1) * PAGE_WIDTH, behavior: 'smooth' });
  };
  const skipToLast = () => {
    pagesRef.current?.scrollTo({ left: (TOTAL - 1) * PAGE_WIDTH, behavior: 'smooth' });
  };

  const onLastPage = current === TOTAL - 1;

  return (
    <div className="splash-th-container relative h-screen w-full overflow-hidden bg-[#FCE7F3]">
      <style>{splashStyles}</style>

      {/* 顶部 logo + dots */}
      <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-6 pt-7">
        <div className="flex items-center gap-2.5">
          <div className="th-heart-logo flex h-9 w-9 items-center justify-center rounded-xl">
            <Heart className="h-5 w-5 fill-white text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight">
              <span style={{ color: '#B8398C' }}>Love</span>
              <span className="text-[#1A1A2E]">Rush</span>
            </div>
            <div className="text-[8px] tracking-[0.25em] text-[#6A7088]/50">为爱冲锋</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span
              key={i}
              className={`th-dot ${i === current ? 'th-dot-active' : ''}`}
              aria-hidden
            />
          ))}
        </div>
      </div>

      {/* 4 页 swipe */}
      <div ref={pagesRef} className="th-pages flex h-full w-full overflow-x-auto overflow-y-hidden">
        {/* === Page 1 · 被看见 === */}
        <section className="th-page relative h-full shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="absolute inset-0 h-full w-full object-cover"
            src={img(0)}
            alt=""
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)',
            }}
          />
          <div className="th-noise" />
          <Twinkle className="right-12 top-40" delay="0s" size={14} fill="#F0BAE5" opacity={0.7} />
          <Twinkle className="left-8 top-[400px]" delay="1s" size={10} fill="#E89BD8" opacity={0.5} />

          <div className="relative z-20 flex h-full flex-col px-8 pb-32 pt-24">
            <div className="flex-1" />
            <div>
              <div className="th-fade-in th-d1 mb-6 th-deco-line" />
              <h1 className="th-fade-in th-d2 font-serif-cn mb-7 text-[26px] font-semibold leading-[1.5] tracking-wide text-[#1A1A2E]">
                你不需要讨好所有人，<br />
                你只需要被<span className="th-hl-magenta">对的人</span>发现
              </h1>
              <p className="th-fade-in th-d3 font-serif-cn text-[14px] leading-[2] text-[#6A7088]">
                你的温柔，<span className="th-hl-soft">不是每个人都懂</span>。<br />
                你的笑，也不是给所有人看的。
              </p>
            </div>
          </div>
        </section>

        {/* === Page 2 · 被尊重 === */}
        <section className="th-page relative h-full shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="absolute inset-0 h-full w-full object-cover"
            src={img(1)}
            alt=""
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)',
            }}
          />
          <div className="th-noise" />

          <div className="relative z-20 flex h-full flex-col px-8 pb-32 pt-24">
            <div className="flex flex-1 items-start pt-12">
              <div className="th-fade-in th-d1 font-cormorant text-sm font-semibold italic tracking-[0.3em] text-[#B8398C]">
                — UNDERVALUED —
              </div>
            </div>
            <div>
              <div className="th-fade-in th-d1 mb-6 th-deco-line" />
              <h1 className="th-fade-in th-d2 font-serif-cn mb-7 text-[26px] font-semibold leading-[1.5] tracking-wide text-[#1A1A2E]">
                你的<span className="th-hl-magenta">价值</span>，<br />
                不该被流量定义
              </h1>
              <p className="th-fade-in th-d3 font-serif-cn mb-5 text-[14px] leading-[2] text-[#6A7088]">
                你是认真的，<br />
                但有些事正在<span className="th-hl-soft">消耗你的认真</span>——
              </p>
              <div className="th-fade-in th-d4 space-y-2.5">
                {[
                  '平台抽成 50%-80%，做得越多被压得越多',
                  '不敢露脸，怕被熟人发现',
                  '客源不稳，今天爆单明天饿肚子',
                  '被无礼客户骚扰，平台不替你说话',
                ].map((t) => (
                  <div key={t} className="flex items-center gap-3 text-[13px] text-[#6A7088]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#B8398C]" />
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* === Page 3 · 被守护 === */}
        <section className="th-page relative h-full shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="absolute inset-0 h-full w-full object-cover"
            src={img(2)}
            alt=""
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)',
            }}
          />
          <div className="th-noise" />

          <div className="relative z-20 flex h-full flex-col px-8 pb-32 pt-24">
            <div className="flex-1" />
            <div>
              <div className="th-fade-in th-d1 mb-6 th-deco-line" />
              <h1 className="th-fade-in th-d2 font-serif-cn mb-5 text-[26px] font-semibold leading-[1.5] tracking-wide text-[#1A1A2E]">
                我们用三件事，<br />
                <span className="th-hl-magenta">认真守护你</span>
              </h1>
              <p className="th-fade-in th-d3 font-serif-cn mb-6 text-[13px] leading-[1.9] text-[#6A7088]">
                你赚的每一笔，都该真正属于你
              </p>
              <div className="th-fade-in th-d4 space-y-2.5">
                <PromiseCard
                  icon={<Wallet className="h-4 w-4 text-[#5EE5A8]" />}
                  iconBg="linear-gradient(135deg, rgba(45,206,137,0.2), rgba(45,206,137,0.05))"
                  title="撮合不抽佣"
                  sub="线下交易 0 抽成 · 钱直接到你手里"
                />
                <PromiseCard
                  icon={<EyeOff className="h-4 w-4 text-[#B8398C]" />}
                  iconBg="linear-gradient(135deg, rgba(232,155,216,0.2), rgba(159,79,168,0.15))"
                  title="隐私分级守护"
                  sub="真实身份永不外露 · 你说了算谁能看"
                />
                <PromiseCard
                  icon={<TrendingUp className="h-4 w-4 text-[#FFB347]" />}
                  iconBg="linear-gradient(135deg, rgba(255,179,71,0.2), rgba(255,138,122,0.05))"
                  title="阶梯权益"
                  sub="越被欣赏 · 曝光越多 · 越自由"
                />
              </div>
            </div>
          </div>
        </section>

        {/* === Page 4 · 行动 === */}
        <section className="th-page relative h-full shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="absolute inset-0 h-full w-full object-cover"
            src={img(3)}
            alt=""
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)',
            }}
          />
          <div className="th-noise" />
          <Twinkle className="right-16 top-32" delay="0.5s" size={14} fill="#F0BAE5" opacity={0.7} />
          <Twinkle className="bottom-[280px] left-12" delay="1.5s" size={12} fill="#E89BD8" opacity={0.6} />

          <div className="relative z-20 flex h-full flex-col px-8 pb-12 pt-24">
            <div className="flex-1" />
            <div>
              <div className="th-fade-in th-d1 mb-5 font-cormorant text-xs font-semibold italic uppercase tracking-[0.4em] text-[#B8398C]">
                Begin Your Story
              </div>
              <h1 className="th-fade-in th-d2 font-serif-cn mb-6 text-[30px] font-semibold leading-[1.4] tracking-wide text-[#1A1A2E]">
                让<span className="th-hl-magenta">认真的你</span>，<br />
                被认真地看见
              </h1>
              <div className="th-fade-in th-d3 th-quote-block mb-6 py-3 pl-4">
                <p className="font-serif-cn text-[13px] italic leading-[1.9] tracking-wide text-[#6A7088]">
                  你的眼神、你的气质、<br />
                  那种让人想靠近的感觉——值得被珍视。
                </p>
              </div>
              <Link href="/register/therapist" className="th-btn-start th-fade-in th-d4">
                <Sparkles className="h-4 w-4" />
                <span className="font-serif-cn tracking-wider">立即入驻 · 0 抽佣</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="th-fade-in th-d5 mt-3 text-center">
                <Link href="/login" className="text-[12.5px] font-semibold tracking-wider text-[#B8398C]">
                  已有账号 · 立即登录 →
                </Link>
              </div>
              <div className="th-fade-in th-d5 mt-4 text-center">
                <Link
                  href="/"
                  className="text-[11px] tracking-wider text-[#6A7088] underline decoration-dotted underline-offset-2 transition hover:text-[#B8398C]"
                >
                  我是客户 · 前往客户版
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 底部 · 跳过/下一步(最后一页隐藏) */}
      <div
        className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-between gap-3 px-6 pb-7 transition-opacity duration-300"
        style={{ opacity: onLastPage ? 0 : 1, pointerEvents: onLastPage ? 'none' : 'auto' }}
      >
        <button type="button" onClick={skipToLast} className="th-btn-skip">
          跳过
        </button>
        <button type="button" onClick={nextPage} className="th-btn-next">
          <span>下一步</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function PromiseCard({
  icon,
  iconBg,
  title,
  sub,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="th-promise-card flex items-center gap-3 rounded-2xl p-3.5">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="leading-snug">
        <div className="mb-0.5 text-[13px] font-semibold text-[#1A1A2E]">{title}</div>
        <div className="text-[11px] text-[#6A7088]/70">{sub}</div>
      </div>
    </div>
  );
}

function Twinkle({
  className,
  delay,
  size,
  fill,
  opacity,
}: {
  className?: string;
  delay: string;
  size: number;
  fill: string;
  opacity: number;
}) {
  return (
    <div className={`th-twinkle absolute ${className ?? ''}`} style={{ animationDelay: delay }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z"
          fill={fill}
          opacity={opacity}
        />
      </svg>
    </div>
  );
}

const splashStyles = `
.splash-th-container { background-color: #FCE7F3; }
.th-pages {
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  scroll-behavior: smooth;
}
.th-pages::-webkit-scrollbar { display: none; }
.th-page { width: 390px; scroll-snap-align: start; }
.th-noise {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.025;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}
.th-heart-logo {
  background: linear-gradient(135deg, #E89BD8 0%, #C66DC6 50%, #9F4FA8 100%);
  box-shadow: 0 0 20px rgba(232,155,216,0.5), inset 0 1px 0 rgba(255,255,255,0.25);
}
.th-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(0,0,0,0.2);
  transition: all 350ms cubic-bezier(0.22, 1, 0.36, 1);
}
.th-dot-active {
  width: 24px; border-radius: 3px;
  background: #E89BD8;
  box-shadow: 0 0 12px rgba(232,155,216,0.6);
}
.th-hl-magenta { color: #B8398C; font-weight: 600; }
.th-hl-soft { color: #9F4FA8; font-weight: 600; }
.th-deco-line {
  height: 2px; width: 40px;
  background: linear-gradient(90deg, #B8398C, transparent);
  border-radius: 2px;
}
.th-quote-block {
  border-left: 2px solid #B8398C;
  background: linear-gradient(90deg, rgba(232,155,216,0.1) 0%, transparent 100%);
}
.th-btn-skip {
  color: rgba(0,0,0,0.45);
  font-size: 13px; letter-spacing: 0.1em;
  padding: 12px 20px;
  transition: color 250ms;
  background: transparent; border: 0;
}
.th-btn-skip:hover { color: rgba(0,0,0,0.75); }
.th-btn-next {
  background: white;
  box-shadow: 0 4px 16px rgba(232,155,216,0.15);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(232,155,216,0.4);
  color: #1A1A2E;
  padding: 14px 28px;
  border-radius: 9999px;
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; letter-spacing: 0.1em;
  transition: all 300ms;
}
.th-btn-next:hover { background: #FFE5F0; border-color: rgba(232,155,216,0.7); }
.th-btn-start {
  width: 100%;
  background: linear-gradient(135deg, #E89BD8 0%, #C66DC6 50%, #9F4FA8 100%);
  box-shadow: 0 16px 40px rgba(232,155,216,0.45), inset 0 1px 0 rgba(255,255,255,0.2);
  color: white;
  padding: 16px 24px;
  border-radius: 16px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  font-size: 15px;
  text-decoration: none;
  transition: all 350ms cubic-bezier(0.22, 1, 0.36, 1);
}
.th-btn-start:hover {
  transform: translateY(-2px);
  box-shadow: 0 20px 60px rgba(232,155,216,0.6);
}
.th-promise-card {
  background: white;
  border: 1px solid rgba(232,155,216,0.18);
  box-shadow: 0 4px 16px rgba(232,155,216,0.08);
}
@keyframes th-fade-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
.th-fade-in { animation: th-fade-up 900ms cubic-bezier(0.22, 1, 0.36, 1) backwards; }
.th-d1 { animation-delay: 100ms; }
.th-d2 { animation-delay: 300ms; }
.th-d3 { animation-delay: 500ms; }
.th-d4 { animation-delay: 700ms; }
.th-d5 { animation-delay: 900ms; }
@keyframes th-twinkle-kf { 0%, 100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.2); } }
.th-twinkle { animation: th-twinkle-kf 3s ease-in-out infinite; }
`;
