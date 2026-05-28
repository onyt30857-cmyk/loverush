'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Heart, Sparkles, ArrowRight, ShieldCheck, Languages } from 'lucide-react';

const TOTAL_PAGES = 4;
const PAGE_WIDTH = 390;

export default function Landing() {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const page = Math.round(el.scrollLeft / PAGE_WIDTH);
      setCurrentPage(page);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  function nextPage() {
    if (currentPage < TOTAL_PAGES - 1) {
      pagesRef.current?.scrollTo({ left: (currentPage + 1) * PAGE_WIDTH, behavior: 'smooth' });
    }
  }
  function goToLast() {
    pagesRef.current?.scrollTo({ left: (TOTAL_PAGES - 1) * PAGE_WIDTH, behavior: 'smooth' });
  }

  return (
    <div className="mobile-container splash-mobile-container">
      {/* === Top bar: logo + dots === */}
      <div className="top-bar">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center heart-logo">
            <Heart className="w-5 h-5 text-white fill-white" />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-base tracking-tight">
              <span style={{ color: '#FF5577' }}>Love</span>
              <span className="text-[#1A1A2E]">Rush</span>
            </div>
            <div className="text-[8px] text-[#6A7088]/50 tracking-[0.25em]">为爱冲锋</div>
          </div>
        </div>
        <div className="dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`dot ${i === currentPage ? 'active' : ''}`} />
          ))}
        </div>
      </div>

      {/* === 4 页轮播 === */}
      <div className="pages" ref={pagesRef}>
        {/* ============ Page 1 · 共鸣 ============ */}
        <section className="page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="page-bg" src="/proto-images/splash-c-1.png" alt="" />
          <div
            className="page-overlay"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)' }}
          />
          <div className="noise" />

          <div className="absolute top-40 right-12 twinkle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z" fill="#FFB5A8" opacity="0.7" />
            </svg>
          </div>
          <div className="absolute top-[400px] left-8 twinkle" style={{ animationDelay: '1s' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z" fill="#FF5577" opacity="0.5" />
            </svg>
          </div>

          <div className="page-content">
            <div className="flex-1"></div>
            <div>
              <div className="fade-in d1">
                <div className="deco-line mb-6"></div>
              </div>
              <h1 className="font-serif-cn text-[26px] font-semibold leading-[1.5] tracking-wide text-[#1A1A2E] mb-7 fade-in d2">
                你心里一直有个<span className="highlight-coral">她的样子</span>，<br />
                只是还没遇见她
              </h1>
              <p className="font-serif-cn text-[14px] text-[#1A1A2E] leading-[2] fade-in d3" style={{ fontWeight: 500 }}>
                不是你的要求太高，也不是缘分太浅。<br />
                只是<span className="highlight-warm">没有人真正读懂你</span>。
              </p>
            </div>
          </div>
        </section>

        {/* ============ Page 2 · 痛点击中 ============ */}
        <section className="page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="page-bg" src="/proto-images/splash-c-2.png" alt="" />
          <div
            className="page-overlay"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)' }}
          />
          <div className="noise" />

          <div className="page-content">
            <div className="flex-1 flex items-start pt-12">
              <div className="font-cormorant italic text-sm font-semibold text-[#E63E5C] tracking-[0.3em] fade-in d1">— TIRED OF —</div>
            </div>
            <div>
              <div className="fade-in d1">
                <div className="deco-line mb-6"></div>
              </div>
              <h1 className="font-serif-cn text-[26px] font-semibold leading-[1.5] tracking-wide text-[#1A1A2E] mb-7 fade-in d2">
                看过那么多照片，<br />
                没一张是<span className="highlight-coral">真在等你的她</span>
              </h1>
              <p className="font-serif-cn text-[14px] text-[#1A1A2E] leading-[2] mb-5 fade-in d3" style={{ fontWeight: 500 }}>
                照骗、敷衍、嘈杂的信息——<br />
                真正<span className="highlight-warm">对的她</span>，被淹没在所有人之间
              </p>
              <div className="space-y-2.5 fade-in d4">
                {['选了好看的，到店发现差 20 岁', '服务和宣传严重不符', '语言不通，期望和服务永远错位'].map((t) => (
                  <div key={t} className="flex items-center gap-3 text-[13px] text-[#1A1A2E]" style={{ fontWeight: 500 }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF5577]"></span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ Page 3 · 解决方案 ============ */}
        <section className="page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="page-bg" src="/proto-images/splash-c-3.png" alt="" />
          <div
            className="page-overlay"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)' }}
          />
          <div className="noise" />

          <div className="page-content">
            <div className="flex-1"></div>
            <div>
              <div className="fade-in d1">
                <div className="deco-line mb-6"></div>
              </div>
              <h1 className="font-serif-cn text-[26px] font-semibold leading-[1.5] tracking-wide text-[#1A1A2E] mb-5 fade-in d2">
                让 <span className="highlight-coral">智能匹配</span>为你筛选，<br />
                让对的她浮现
              </h1>
              <p className="font-serif-cn text-[14px] text-[#1A1A2E] leading-[2] mb-6 fade-in d3" style={{ fontWeight: 500 }}>
                千万种气质里，系统记住你的心意，<br />
                把她，<span className="highlight-warm">送到你眼前</span>
              </p>
              <div className="space-y-2.5 fade-in d4">
                <div className="promise-card rounded-2xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgba(255,138,122,0.2), rgba(255,85,119,0.15))' }}>
                    <ShieldCheck className="w-4 h-4 text-[#FF8A7A]" />
                  </div>
                  <div className="text-[12.5px] text-[#1A1A2E]/85 leading-snug">
                    <span className="text-[#1A1A2E] font-semibold">隐私守护</span>
                    <span className="text-[#6A7088]/70 ml-1">计算器伪装模式</span>
                  </div>
                </div>
                <div className="promise-card rounded-2xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgba(255,138,122,0.2), rgba(61,79,192,0.15))' }}>
                    <Languages className="w-4 h-4 text-[#B5C3FF]" />
                  </div>
                  <div className="text-[12.5px] text-[#1A1A2E]/85 leading-snug">
                    <span className="text-[#1A1A2E] font-semibold">跨语言私聊</span>
                    <span className="text-[#6A7088]/70 ml-1">中/英/泰/越/马来/印尼</span>
                  </div>
                </div>
                <div className="promise-card rounded-2xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgba(45,206,137,0.2), rgba(45,206,137,0.05))' }}>
                    <ShieldCheck className="w-4 h-4 text-[#5EE5A8]" />
                  </div>
                  <div className="text-[12.5px] text-[#1A1A2E]/85 leading-snug">
                    <span className="text-[#1A1A2E] font-semibold">真实真人核验认证</span>
                    <span className="text-[#6A7088]/70 ml-1">不再货不对版</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ Page 4 · 行动召唤 ============ */}
        <section className="page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="page-bg" src="/proto-images/splash-c-4.png" alt="" />
          <div
            className="page-overlay"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.05) 30%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0.95) 80%, #FAFAFA 100%)' }}
          />
          <div className="noise" />

          <div className="absolute top-32 right-16 twinkle" style={{ animationDelay: '0.5s' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z" fill="#FFB5A8" opacity="0.7" />
            </svg>
          </div>
          <div className="absolute bottom-[280px] left-12 twinkle" style={{ animationDelay: '1.5s' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z" fill="#FF5577" opacity="0.6" />
            </svg>
          </div>

          <div className="page-content">
            <div className="flex-1"></div>
            <div>
              <div className="fade-in d1">
                <div className="font-cormorant italic text-xs font-semibold text-[#E63E5C] tracking-[0.4em] uppercase mb-5">Find Her Tonight</div>
              </div>
              <h1 className="font-serif-cn text-[32px] font-semibold leading-[1.35] tracking-wide text-[#1A1A2E] mb-6 fade-in d2">
                今晚，<br />
                遇见<span className="highlight-coral">对的那个她</span>
              </h1>
              <div className="quote-block pl-4 py-3 mb-6 fade-in d3">
                <p className="font-serif-cn italic text-[13px] text-[#6A7088] leading-[1.9] tracking-wide">
                  不再大海捞针，不再货不对版。<br />
                  你的那个，就在这里等着被找到。
                </p>
              </div>
              <Link href="/register" className="btn-start w-full fade-in d4" style={{ display: 'flex', textDecoration: 'none' }}>
                <Sparkles className="w-4 h-4" />
                <span className="font-serif-cn tracking-wider">立即注册 · 智能匹配</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <div className="text-center mt-3 fade-in d5">
                <Link href="/recover" className="text-[12.5px] text-[#FF5577] font-semibold tracking-wider">
                  已有账号 · 助记词登录 →
                </Link>
              </div>
              <div className="text-center mt-2 fade-in d5">
                <Link href="/splash/therapist" className="text-[12.5px] text-[#6A7088] font-medium tracking-wider">
                  我是技师 · 入驻接单 →
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* === 底部按钮（最后一页隐藏） === */}
      <div
        className="bottom-bar"
        style={{
          opacity: currentPage === TOTAL_PAGES - 1 ? 0 : 1,
          pointerEvents: currentPage === TOTAL_PAGES - 1 ? 'none' : 'auto',
          transition: 'opacity 300ms',
        }}
      >
        <button className="btn-skip" type="button" onClick={goToLast}>跳过</button>
        <button className="btn-next" type="button" onClick={nextPage}>
          <span>下一步</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
