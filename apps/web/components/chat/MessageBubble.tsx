/**
 * 私聊消息气泡 · 对齐微信 / WhatsApp
 *
 * 布局:
 *   对方:[头像]  [灰白气泡]                    左对齐
 *   自己:                  [玫红气泡]  [头像]   右对齐
 *
 * 同 sender 连续多条时,只在最后一条显示头像(iMessage 风格,减视觉噪音)。
 */
'use client';

import { Avatar } from '@/components/ui';

export interface MessageBubbleProps {
  mine: boolean;
  body: string;
  /** 翻译(可选)· 显在原文下方 */
  translatedBody?: string | null;
  senderAvatarUrl?: string | null;
  senderDisplayName?: string | null;
  /** 是否显示头像(连续消息组的最后一条)· 默认 true */
  showAvatar?: boolean;
  /** 时间戳(可选)· 简短显示 */
  time?: string | null;
}

export function MessageBubble({
  mine,
  body,
  translatedBody,
  senderAvatarUrl,
  senderDisplayName,
  showAvatar = true,
  time,
}: MessageBubbleProps) {
  const fallback = (senderDisplayName ?? '').slice(0, 1) || '🙂';

  return (
    <div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="shrink-0">
        {showAvatar ? (
          <Avatar size={32} src={senderAvatarUrl ?? undefined} fallback={fallback} />
        ) : (
          <div className="h-8 w-8" aria-hidden />
        )}
      </div>
      <div className={`max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        <div className={mine ? 'msg-bubble-mine' : 'msg-bubble-other'}>
          <div className="whitespace-pre-wrap break-words">{body}</div>
          {translatedBody ? (
            <div className={`mt-1 border-t pt-1 text-[11.5px] leading-relaxed ${mine ? 'border-white/30 text-white/85' : 'border-ink-100 text-ink-500'}`}>
              {translatedBody}
            </div>
          ) : null}
        </div>
        {time ? <div className="px-1 text-[10px] text-ink-400">{time}</div> : null}
      </div>
    </div>
  );
}
