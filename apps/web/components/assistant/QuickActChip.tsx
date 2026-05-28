/**
 * 单个快捷意图 chip · M03 F03-Home1 区块 4 子项
 *
 * 点击 → /assistant/chat?intent_seed=xxx (预填用户输入到对话页 · 替代自由文本)
 */
'use client';

import Link from 'next/link';
import type { QuickAct } from './types';

interface Props {
  act: QuickAct;
}

export function QuickActChip({ act }: Props) {
  return (
    <Link
      href={`/assistant/chat?intent_seed=${encodeURIComponent(act.intent_seed)}`}
      aria-label={act.label}
      className="chip-quick whitespace-nowrap"
    >
      {act.label}
    </Link>
  );
}
