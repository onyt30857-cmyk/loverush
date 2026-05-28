/**
 * AI 台词气泡(逐字打字效果)· M03 F03-OB1
 *
 * 进入新轮 → 先 500-2000ms 类人打字延迟 → 再以约 30 字/秒速度逐字显示。
 * 用 GradientOrb 头像 + msg-bubble-other 视觉,与对话页一致。
 */
'use client';

import { useEffect, useState } from 'react';
import { GradientOrb, TypingDots } from '@/components/ui';

interface Props {
  text: string;
  /** 是否跳过打字效果(老内容回填用)· 默认 false */
  instant?: boolean;
  /** 打字完成后回调 */
  onDone?: () => void;
}

/** 类人打字延迟 · 0.5-2s 随机 */
function delayMs(): number {
  return 500 + Math.floor(Math.random() * 1500);
}

export function AITypingBubble({ text, instant = false, onDone }: Props) {
  const [stage, setStage] = useState<'pending' | 'typing' | 'done'>(instant ? 'done' : 'pending');
  const [shown, setShown] = useState(instant ? text : '');

  useEffect(() => {
    if (instant) {
      setStage('done');
      setShown(text);
      return;
    }
    setStage('pending');
    setShown('');
    const startTimer = setTimeout(() => {
      setStage('typing');
    }, delayMs());
    return () => clearTimeout(startTimer);
  }, [text, instant]);

  useEffect(() => {
    if (stage !== 'typing') return;
    if (shown === text) {
      setStage('done');
      onDone?.();
      return;
    }
    const i = shown.length;
    // 约 30 字/秒 · 偶尔停顿
    const speed = 30 + Math.random() * 30;
    const tm = setTimeout(() => {
      setShown(text.slice(0, i + 1));
    }, speed);
    return () => clearTimeout(tm);
  }, [stage, shown, text, onDone]);

  return (
    <div className="flex items-end gap-2 animate-fade-up">
      <GradientOrb size={32} icon="✨" />
      <div className="msg-bubble-other max-w-[80%]" aria-live="polite">
        {stage === 'pending' ? <TypingDots /> : <span className="whitespace-pre-wrap">{shown}</span>}
      </div>
    </div>
  );
}
