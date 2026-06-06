'use client';

/**
 * 首页顶部「今夜在线」沉浸式精选大图卡(横滑)。
 * 设计依据见 docs/superpowers/specs/2026-06-07-home-immersive-photo-hero-design.md:
 *   照片是命门 → 近全屏大图把脸放最大;横滑=决策手势(一次看一个、心动→点进去),非竖滑消费;
 *   供给有限 → 精选 showcase 非无限 feed;在线优先=真实稀缺;极简信息+绝不放价格(零推销)。
 * 纯前端:数据由 home 从现有 /therapists 列表派生(在线优先、取前 8),零新接口零迁移。
 */
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MapPin, Star } from 'lucide-react';

export interface HeroPick {
  href: string;
  img: string;
  name: string;
  online: boolean;
  city: string;
  distance: string;
  highlight: string; // 1 个亮点:身高优先,无则语言
  score: string;
}

export function HeroPicksCarousel({
  picks,
  onPrefetch,
  bottomOverlay,
}: {
  picks: HeroPick[];
  onPrefetch?: (href: string) => void;
  /** 浮层槽:筛选 chips 压在大图底部渐变上(控件与照片融合,不堆图下面) */
  bottomOverlay?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  if (picks.length === 0) return null;

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const step = el.scrollWidth / picks.length;
    const i = step > 0 ? Math.round(el.scrollLeft / step) : 0;
    setActive(Math.min(picks.length - 1, Math.max(0, i)));
  }

  return (
    <section className="pt-2 pb-1">
      {/* 区头:AI 智能匹配 + 贴心副标(小助理为你精挑,贴心+智能) */}
      <div className="px-4 pb-2.5">
        <div className="font-cormorant italic uppercase tracking-[0.28em] text-[11px] text-[#E8546B]">AI · Matched for You</div>
        <h2 className="serif-cn text-[22px] font-semibold text-[#1A1614] leading-tight">AI 智能匹配</h2>
        <div className="mt-1.5 text-[12.5px] leading-relaxed text-[#8A817C]">
          小助理懂你的喜好,<span className="font-medium text-[#E8546B]">为你精挑了这几位</span> ✦
        </div>
      </div>

      {/* 横滑卡 · snap-center 居中吸附 · 两侧露 peek 暗示可滑 · 不自动轮播 · 筛选 chips 浮层压在图底 */}
      <div className="relative">
      <div ref={ref} onScroll={onScroll} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {picks.map((p, i) => (
          <Link
            key={p.href}
            href={p.href}
            prefetch
            onMouseEnter={() => onPrefetch?.(p.href)}
            onTouchStart={() => onPrefetch?.(p.href)}
            className="relative block aspect-[3/4] w-[86vw] max-w-[400px] shrink-0 snap-center overflow-hidden rounded-3xl bg-ink-100 shadow-warm-sm animate-fade-up"
            style={{ animationDelay: `${Math.min(i * 40, 160)}ms` }}
          >
            {p.img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.img} alt={p.name} className="h-full w-full object-cover object-[center_22%]" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-cta text-6xl font-semibold text-white/85">
                {p.name.slice(0, 1)}
              </div>
            )}

            {/* 底部极简信息(无价格/无钩子/无在线徽章/无独宠) */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent p-4">
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate serif-cn text-[22px] font-semibold text-white drop-shadow">{p.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-white/90">
                    {p.city && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" />
                        {p.city}
                      </span>
                    )}
                    {p.distance && <span>{p.distance}</span>}
                    {p.highlight && <span>{p.highlight}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/95 px-2 py-0.5">
                  <Star className="h-3 w-3 fill-warning-500 text-warning-500" />
                  <span className="num text-[11px] font-bold text-ink-900">{p.score}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
        {/* 筛选 chips 浮层 · 压在当前大图底部渐变上(控件融进照片,不堆图下面) */}
        {bottomOverlay && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10">
            <div className="pointer-events-auto">{bottomOverlay}</div>
          </div>
        )}
      </div>

      {/* 页码圆点 */}
      {picks.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {picks.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === active ? 'w-4 bg-[#FF5577]' : 'w-1.5 bg-ink-300'}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
