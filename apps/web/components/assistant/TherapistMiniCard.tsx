/**
 * 紧凑技师卡 · M03 v3 区块 3 子项
 *
 * 视觉:~120w × 180h (3 张横排在 390 宽屏可塞下,允许微滑)
 *   头像 + 名 + ★ 评分 + 距离(null 不显) + 空档(null 不显) + tags + 2 个 CTA(约 / 聊)
 *
 * 行为:
 *  - "约" → /therapist/${id}
 *  - "聊" → 触发 onChat (InlineChatInput 预填 "聊聊 ${display_name}" + focus)
 */
'use client';

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import type { TherapistMiniCardData } from './types';

interface Props {
  data: TherapistMiniCardData;
  onChat?: (prefillText: string) => void;
}

export function TherapistMiniCard({ data, onChat }: Props) {
  const star = (data.score_service / 10).toFixed(1);
  return (
    <article className="flex w-[120px] flex-shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-sm">
      {/* 头像区 */}
      <Link
        href={`/therapist/${data.therapist_id}`}
        className="relative block h-[96px] w-full overflow-hidden bg-warm-50"
        aria-label={`查看 ${data.display_name}`}
      >
        {data.avatar_url ? (
          <img
            src={data.avatar_url}
            alt={data.display_name}
            className="h-full w-full object-cover"
            style={{ objectPosition: 'center 25%' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🙂</div>
        )}
        {/* 评分小药丸 */}
        <span className="score-pill absolute bottom-1 right-1 !text-[9.5px]">★ {star}</span>
        {/* tags 角标(取首个 · 例如"新") */}
        {data.tags[0] && (
          <span className="absolute left-1 top-1 rounded bg-warm-500/90 px-1 py-0.5 text-[9px] font-bold tracking-wide text-white">
            {data.tags[0]}
          </span>
        )}
      </Link>

      {/* 文本区 */}
      <div className="flex flex-1 flex-col gap-1 px-2 pt-1.5 pb-2">
        <h3 className="truncate text-serif-cn text-[12px] font-semibold text-ink-800">{data.display_name}</h3>
        <div className="flex flex-col gap-0.5 text-[10px] leading-4 text-ink-500">
          {data.distance_km != null && <span>{data.distance_km.toFixed(1)}km</span>}
          {data.next_slot && <span className="text-warm-700">{data.next_slot}</span>}
        </div>
        {/* 2 个 CTA */}
        <div className="mt-1 flex gap-1">
          <Link
            href={`/therapist/${data.therapist_id}`}
            className="flex-1 rounded-md bg-gradient-cta py-1 text-center text-[10.5px] font-medium text-white active:scale-95"
            aria-label={`约 ${data.display_name}`}
          >
            约
          </Link>
          <button
            type="button"
            onClick={() => onChat?.(`聊聊 ${data.display_name}`)}
            className="flex h-6 w-7 items-center justify-center rounded-md border border-warm-200 text-ink-600 active:scale-95"
            aria-label={`聊聊 ${data.display_name}`}
          >
            <MessageCircle className="h-3 w-3" />
          </button>
        </div>
      </div>
    </article>
  );
}
