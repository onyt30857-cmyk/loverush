'use client';

import { AppShell } from '@/components/AppShell';
import { Shimmer } from '@/components/ui';

export default function MeLoading() {
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
