'use client';

/**
 * 锁价页骨架 · /therapist/[id]/order
 *
 * 形状对齐 page.tsx 真实结构:
 *   顶部 nav(返回 + 标题) → 技师服务卡(头像 + 名字 + 套餐价位)
 *   → 7 个日期 chip(横排) → 4 列时段 grid → 含/不含项目卡 →
 *   底部 sticky CTA(总价 + 锁定按钮)
 */

import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ui';

function PriceLockSkeleton() {
  return (
    <div className="mobile-container bg-white">
      {/* 顶部 nav */}
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-ink-100 bg-white/95 px-4 backdrop-blur">
        <Shimmer className="h-7 w-7 rounded-full" />
        <Shimmer className="h-4 w-20 rounded-md" />
        <span className="w-7" />
      </header>

      <div className="px-4 pb-32 pt-3 space-y-4">
        {/* 服务卡 · 技师头像 + 名字 + 价位行 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-md">
          <div className="flex items-center gap-3">
            <Shimmer className="h-12 w-12 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-1.5">
              <Shimmer className="h-4 w-24 rounded-md" />
              <Shimmer className="h-2.5 w-32 rounded-md opacity-70" />
            </div>
          </div>
          {/* 价位选项 · 通常 2-3 个套餐 */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Shimmer key={i} className={`h-14 rounded-xl ${i === 0 ? '' : 'opacity-70'}`} />
            ))}
          </div>
        </div>

        {/* 日期选择 · 标题 + 7 个 chip */}
        <div>
          <Shimmer className="mb-2.5 h-3.5 w-16 rounded-md" />
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="flex shrink-0 flex-col items-center gap-1.5 rounded-xl border border-warm-100 bg-white px-3 py-2 shadow-warm-xs"
                style={{ minWidth: 56 }}
              >
                <Shimmer className="h-3 w-8 rounded-md" />
                <Shimmer className="h-4 w-10 rounded-md opacity-80" />
              </div>
            ))}
          </div>
        </div>

        {/* 时段 grid · 4 列 × 3 行 */}
        <div>
          <Shimmer className="mb-2.5 h-3.5 w-20 rounded-md" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Shimmer
                key={i}
                className={`h-11 rounded-xl ${i % 5 === 0 ? 'opacity-40' : ''}`}
              />
            ))}
          </div>
        </div>

        {/* 含/不含项目卡 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 space-y-3 shadow-warm-xs">
          <Shimmer className="h-3.5 w-20 rounded-md" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-2">
              <Shimmer className="mt-1 h-3 w-3 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1">
                <Shimmer className="h-3 w-20 rounded-md" />
                <Shimmer className="h-2.5 w-32 rounded-md opacity-60" />
              </div>
            </div>
          ))}
        </div>

        {/* 小费选项 · 4 个 chip */}
        <div>
          <Shimmer className="mb-2.5 h-3.5 w-16 rounded-md" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Shimmer
                key={i}
                className={`h-10 flex-1 rounded-xl ${i === 0 ? '' : 'opacity-70'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* sticky 底部 CTA · 总价 + 锁定按钮 */}
      <div className="sticky bottom-0 z-30 mt-auto border-t border-warm-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Shimmer className="h-2.5 w-12 rounded-md opacity-70" />
            <Shimmer className="h-6 w-16 rounded-md" />
          </div>
          <Shimmer className="h-12 flex-1 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default function PriceLockLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <PriceLockSkeleton /> : null;
}
