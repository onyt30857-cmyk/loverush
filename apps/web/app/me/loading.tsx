'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Shimmer } from '@/components/ui';

/**
 * 200ms 防闪：进入 200ms 内不显骨架，避免 SPA 切换时的「白闪 + 跳变」。
 * 形状保持与最终页面对齐：头部卡 + 4 宫格 + 列表行。
 * 见 docs/INTERACTION-STANDARDS.md §4。
 */
function MeSkeleton() {
  return (
    <AppShell>
      <div className="space-y-4 px-4 pt-4">
        <Shimmer className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Shimmer key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

export default function MeLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  return show ? <MeSkeleton /> : null;
}
