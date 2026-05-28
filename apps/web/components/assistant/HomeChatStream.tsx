/**
 * Home 内嵌 chat 流(简化版 · 类 Pi)· M03 v3
 *
 * 与 /assistant/chat 全屏对话页区别:
 *  - 无长按菜单(直接 select-text 复制)
 *  - 无 emoji picker
 *  - 不持久化(每次进 home 重置)
 *  - 支持推荐卡 + 跨次记忆挂卡(复用 RecommendCard / MemoryRecallChip)
 *
 * 输入框不在这里 · 由父组件的 InlineChatInput 提供.
 */
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ErrorBanner, GradientOrb, TypingDots } from '@/components/ui';
import { RecommendCard } from '@/components/RecommendCard';
import { MemoryRecallChip } from '@/components/MemoryRecallChip';
import { formatAssistantMessage } from '@/lib/format-message';
import type { ChatTurn } from '@/lib/use-assistant-chat';

interface Props {
  turns: ChatTurn[];
  typing: boolean;
  error: string | null;
}

export function HomeChatStream({ turns, typing, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, typing]);

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
      <ErrorBanner message={error} />

      <div className="space-y-2.5">
        {turns.map((t) => (
          <MessageRow key={t.id} turn={t} />
        ))}
        {typing && (
          <div className="flex items-end gap-2 animate-fade-up">
            <GradientOrb size={28} icon="✨" />
            <div className="msg-bubble-other">
              <TypingDots />
            </div>
          </div>
        )}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}

function MessageRow({ turn }: { turn: ChatTurn }) {
  const isMine = turn.role === 'user';
  const time = useMemo(
    () => new Date(turn.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [turn.ts],
  );

  return (
    <div className="animate-fade-up">
      <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
        {!isMine && <GradientOrb size={28} icon="✨" />}
        <div className="flex max-w-[78%] flex-col gap-1">
          <div className={isMine ? 'msg-bubble-mine' : 'msg-bubble-other'}>
            {isMine ? turn.content : <FormattedMessage text={turn.content} />}
          </div>
          <div
            className={`flex items-center gap-1.5 px-1 text-[9.5px] text-ink-400 ${
              isMine ? 'justify-end' : 'justify-start'
            }`}
          >
            <span>{time}</span>
            {isMine && turn.status && (
              <span aria-label={`消息状态:${turn.status}`}>
                {turn.status === 'sending' && '· 发送中'}
                {turn.status === 'sent' && '· ✓'}
                {turn.status === 'read' && '· ✓✓ 已读'}
                {turn.status === 'failed' && (
                  <span className="text-danger-500">· 发送失败</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {turn.role === 'assistant' && turn.recall && <MemoryRecallChip recall={turn.recall} />}

      {turn.role === 'assistant' && turn.recommends && turn.recommends.length > 0 && (
        <div className="ml-9 mt-2">
          <div className="label-cormorant mb-1.5">{turn.recommends.length} 位推荐</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {turn.recommends.map((r) => (
              <RecommendCard key={r.therapistId} item={r} variant="slim" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FormattedMessage({ text }: { text: string }) {
  const segments = useMemo(() => formatAssistantMessage(text), [text]);
  if (segments.length === 0) return <span>{text}</span>;
  return (
    <div className="space-y-1.5">
      {segments.map((seg, i) => {
        if (seg.type === 'spacer') {
          return <div key={i} className="h-1" />;
        }
        if (seg.type === 'list_item') {
          return (
            <div key={i} className="flex gap-2">
              <span className="mt-0.5 select-none text-warm-500">·</span>
              <span className="flex-1">{seg.text}</span>
            </div>
          );
        }
        return (
          <p key={i} className={seg.bold ? 'font-semibold text-ink-900' : ''}>
            {seg.text}
          </p>
        );
      })}
    </div>
  );
}
