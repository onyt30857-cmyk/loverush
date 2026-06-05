/**
 * 陪聊时段倒计时条 · ChatSessionRibbon
 *
 * 有进行中的陪聊时段时,会话页顶部显示"和{她}的陪聊 · 还剩 MM:SS"。
 * 倒计时到 0 → onExpire(父清状态),条消失。区别于心动值条(IntimacyRibbon)。
 */
'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  /** ISO 过期时刻;null = 无进行中时段(不显示) */
  expireAt: string | null;
  therapistName?: string | null;
  onExpire?: () => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ChatSessionRibbon({ expireAt, therapistName, onExpire }: Props) {
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!expireAt) return;
    const end = new Date(expireAt).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) onExpire?.();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expireAt]);

  if (!expireAt || remaining <= 0) return null;
  const who = therapistName || '她';

  return (
    <div className="flex items-center justify-center gap-1.5 border-b border-primary-100/70 bg-gradient-to-r from-primary/5 to-warm-50 px-4 py-1.5 text-[11px] text-primary-600">
      <Clock className="h-3 w-3" />
      <span>和{who}的陪聊 · 还剩 <span className="num font-semibold">{fmt(remaining)}</span></span>
    </div>
  );
}
