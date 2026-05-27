'use client';

import { CustomerBottomNav } from '@/components/BottomNav';
import { ListSkeleton } from '@/components/ui';

export default function OrderLoading() {
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
