'use client';

import { useEffect, useState } from 'react';
import { CustomerBottomNav } from '@/components/BottomNav';
import { ListSkeleton } from '@/components/ui';

/**
 * 200ms 防闪：进入 200ms 内不显骨架，避免 SPA 切换时的「白闪 + 跳变」。
 * 形状保持与最终页面对齐：tab 头 + 列表行 + 底部 nav。
 * 见 docs/INTERACTION-STANDARDS.md §4。
 */
function OrderSkeleton() {
  return (
    <div className="mobile-container bg-gradient-soft">
      <div className="sticky top-0 z-20 grid grid-cols-3 border-b border-warm-100 bg-white">
        {['进行中', '历史', '全部'].map((t, i) => (
          <div key={t} className={`py-3 text-center text-[13px] font-medium ${i === 0 ? 'text-primary' : 'text-ink-500'}`}>
            {t}
          </div>
        ))}
      </div>
      <ListSkeleton rows={5} />
      <CustomerBottomNav active="orders" />
    </div>
  );
}

export default function OrderLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <OrderSkeleton /> : null;
}
