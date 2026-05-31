'use client';

/**
 * 订单详情骨架 · 客户视角
 *
 * 形状对齐 page.tsx 真实结构:
 *   AppShell(标题 + 返回 + hideTabBar) → 大状态卡(渐变背景) →
 *   skills tag 行 → 4 行字段卡 → 底部主 CTA + 次 CTA
 *
 * 真实页面用 `AppShell title showBack hideTabBar`,header 高 48px。
 */

import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ui';

function OrderDetailSkeleton() {
  return (
    <div className="mobile-container">
      {/* 顶部 AppShell header · 返回 + 标题 */}
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-ink-100 bg-white/95 px-4 backdrop-blur">
        <Shimmer className="h-7 w-7 rounded-full" />
        <Shimmer className="h-4 w-28 rounded-md" />
      </header>

      <div className="bg-gradient-soft px-5 py-5">
        {/* 大状态卡 · 玫瑰渐变 · 状态文字 + 积分 + 时长 */}
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 shadow-rose-lg">
          <Shimmer className="h-2.5 w-20 rounded-md bg-white/30" />
          <div className="mt-2">
            <Shimmer className="h-7 w-36 rounded-md bg-white/40" />
          </div>
          <div className="mt-5 flex items-end justify-between">
            <div className="space-y-1.5">
              <Shimmer className="h-9 w-20 rounded-md bg-white/40" />
              <Shimmer className="h-2.5 w-8 rounded-md bg-white/30" />
            </div>
            <div className="space-y-1.5 text-right">
              <Shimmer className="h-5 w-12 rounded-md bg-white/40 ml-auto" />
              <Shimmer className="h-2.5 w-10 rounded-md bg-white/30 ml-auto" />
            </div>
          </div>
        </div>

        {/* skills tag 行 */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Shimmer className="h-6 w-14 rounded-full" />
          <Shimmer className="h-6 w-16 rounded-full" />
          <Shimmer className="h-6 w-12 rounded-full opacity-80" />
        </div>

        {/* 字段卡 · 4 行 · 模拟订单号 / 下单时间 / 支付时间 / 备注 */}
        <div className="mt-5 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`flex items-center justify-between py-2.5 ${i < 3 ? 'border-b border-warm-50' : ''}`}
            >
              <Shimmer className="h-3 w-16 rounded-md opacity-70" />
              <Shimmer className="h-3 w-28 rounded-md" />
            </div>
          ))}
        </div>

        {/* 底部 CTA · 主按钮 + 次按钮 */}
        <div className="mt-6 space-y-2.5">
          <Shimmer className="h-12 w-full rounded-2xl" />
          <Shimmer className="h-11 w-full rounded-2xl opacity-60" />
        </div>
      </div>
    </div>
  );
}

export default function OrderDetailLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <OrderDetailSkeleton /> : null;
}
