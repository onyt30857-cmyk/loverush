/**
 * 快捷意图横滑行 · M03 F03-Home1 区块 4
 *
 * 4-6 个 chip · 替代自由文本 · 降低直男冷启动门槛。
 */
'use client';

import { QuickActChip } from './QuickActChip';
import type { QuickAct } from './types';

interface Props {
  acts: QuickAct[];
}

export function QuickActsRow({ acts }: Props) {
  if (acts.length === 0) return null;
  return (
    <section className="px-4 pb-4" aria-labelledby="quick-acts-heading">
      <h2 id="quick-acts-heading" className="mb-2 text-serif-cn text-[14px] font-semibold text-ink-800">
        ⚡ 快捷意图
      </h2>
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {acts.map((a) => (
          <QuickActChip key={a.key} act={a} />
        ))}
      </div>
    </section>
  );
}
