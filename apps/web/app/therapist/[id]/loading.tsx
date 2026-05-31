'use client';

/**
 * 技师详情骨架 · 跨洲 1.5-2s 期间不再全屏白
 *
 * 形状对齐 page.tsx 真实结构:
 *   hero-photo(4:5 大图) → head-card(头像+昵称+评分) → meta 行 →
 *   info-card(标签 + 语音条) → 相册栏 → sticky 4 列 tab → 底部 CTA
 *
 * 200ms 防闪:快请求不闪骨架;高度预留真实避免数据到达时大跳。
 * 见 docs/INTERACTION-STANDARDS.md §4。
 */

import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ui';

function TherapistDetailSkeleton() {
  return (
    <div className="mobile-container">
      {/* hero 4:5 大图区 · 占首屏 */}
      <div className="relative w-full overflow-hidden bg-warm-50" style={{ aspectRatio: '4 / 5' }}>
        <Shimmer className="absolute inset-0 rounded-none" />
        {/* 顶部 nav 浮层 · 左返回 / 中标题 / 右收藏更多 */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-3">
          <Shimmer className="h-8 w-8 rounded-full" />
          <Shimmer className="h-3 w-16 rounded-md opacity-80" />
          <div className="flex gap-1.5">
            <Shimmer className="h-8 w-8 rounded-full" />
            <Shimmer className="h-8 w-8 rounded-full" />
          </div>
        </div>
        {/* 底部名字 + 评分 */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-5 pb-5">
          <div className="space-y-2">
            <Shimmer className="h-5 w-28 rounded-md" />
            <Shimmer className="h-3 w-20 rounded-md opacity-80" />
          </div>
          <div className="space-y-1.5 text-right">
            <Shimmer className="h-6 w-12 rounded-md ml-auto" />
            <Shimmer className="h-2.5 w-16 rounded-md opacity-80" />
          </div>
        </div>
      </div>

      {/* head-card · 头像独立亮相 */}
      <div className="-mt-6 mx-4 flex items-center gap-3 rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-md">
        <Shimmer className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Shimmer className="h-4 w-24 rounded-md" />
            <Shimmer className="h-4 w-14 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Shimmer className="h-3 w-12 rounded-md" />
            <Shimmer className="h-3 w-10 rounded-md opacity-70" />
            <Shimmer className="h-3 w-10 rounded-md opacity-70" />
          </div>
        </div>
      </div>

      {/* hero-meta 行 */}
      <div className="mt-2 flex items-center gap-2 px-4">
        <Shimmer className="h-3 w-16 rounded-md" />
        <Shimmer className="h-3 w-20 rounded-md opacity-70" />
        <Shimmer className="h-3 w-24 rounded-md opacity-70" />
      </div>

      {/* info-card · 标签 + 语音条 */}
      <div className="mx-4 mt-3 space-y-3 rounded-2xl border border-warm-100 bg-white p-3.5 shadow-warm-xs">
        <div className="flex flex-wrap gap-1.5">
          <Shimmer className="h-5 w-12 rounded-full" />
          <Shimmer className="h-5 w-14 rounded-full" />
          <Shimmer className="h-5 w-10 rounded-full" />
          <Shimmer className="h-5 w-16 rounded-full opacity-80" />
          <Shimmer className="h-5 w-12 rounded-full opacity-80" />
        </div>
        {/* 语音条 · 圆按钮 + 波形 + 时长 */}
        <div className="flex items-center gap-3">
          <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-2.5 w-20 rounded-md opacity-70" />
            <div className="flex h-6 items-end gap-[2px]">
              {Array.from({ length: 18 }).map((_, i) => (
                // 用 inline style 给波形高度节奏 · 模拟真实音频条 30-100%
                <div
                  key={i}
                  className="skel w-[3px] rounded-sm"
                  style={{ height: `${30 + ((i * 17) % 70)}%` }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1 text-right">
            <Shimmer className="h-3 w-8 rounded-md ml-auto" />
            <Shimmer className="h-2.5 w-12 rounded-md ml-auto opacity-60" />
          </div>
        </div>
      </div>

      {/* 相册栏 · 头部 + tabs + 3 列 grid */}
      <div className="mx-4 mt-3 rounded-2xl border border-warm-100 bg-white p-3.5 shadow-warm-xs">
        <div className="mb-3 flex items-center justify-between">
          <Shimmer className="h-4 w-16 rounded-md" />
          <Shimmer className="h-3 w-20 rounded-full opacity-70" />
        </div>
        <div className="mb-3 flex gap-2">
          <Shimmer className="h-7 w-20 rounded-full" />
          <Shimmer className="h-7 w-20 rounded-full opacity-60" />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      </div>

      {/* sticky tab bar 4 列 · 关于/橱窗/服务/评价 */}
      <div className="sticky top-0 z-20 mt-3 grid grid-cols-4 border-b border-warm-100 bg-white">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-center py-3">
            <Shimmer className={`h-3 w-10 rounded-md ${i === 0 ? '' : 'opacity-60'}`} />
          </div>
        ))}
      </div>

      {/* About section · 3 个信息块 */}
      <section className="px-5 py-4 space-y-3">
        <Shimmer className="h-2.5 w-16 rounded-md opacity-70" />
        <Shimmer className="h-5 w-24 rounded-md" />
        <div className="rounded-2xl border border-warm-100 bg-white p-4 space-y-2 shadow-warm-xs">
          <Shimmer className="h-2.5 w-14 rounded-md opacity-70" />
          <Shimmer className="h-3 w-full rounded-md" />
          <Shimmer className="h-3 w-4/5 rounded-md" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-warm-100 bg-white p-3 space-y-1.5 shadow-warm-xs">
              <Shimmer className="h-2.5 w-12 rounded-md opacity-70" />
              <Shimmer className="h-3.5 w-16 rounded-md" />
            </div>
          ))}
        </div>
      </section>

      {/* 底部 sticky CTA 区 · 私聊 + 锁定她 + 小费 */}
      <div className="sticky bottom-0 z-30 mt-auto border-t border-warm-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Shimmer className="h-12 w-12 shrink-0 rounded-2xl" />
          <Shimmer className="h-12 flex-1 rounded-2xl" />
          <Shimmer className="h-12 w-12 shrink-0 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default function TherapistDetailLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // 200ms 防闪 · 快请求时不闪骨架
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <TherapistDetailSkeleton /> : null;
}
