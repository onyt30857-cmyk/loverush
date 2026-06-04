'use client';
/**
 * 心动陪伴 · 私密图锁定卡（M18 撩拨发图 Phase 3）
 *
 * 「她有张照片想给你看…」—— 模糊缩略图 + 心锁，点解锁走付费换图。
 * 不硬软卡：暖措辞、零交易词（不写"购买/解锁费/余额"）。
 * 解锁 → POST /companion-media/:mediaId/unlock → 拿真实 imageUrl 回插一条 her 图气泡。
 * 心动值不够(E2010) → 软提示 + 引去充值页。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Heart } from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/api';

export interface LockedMediaOffer {
  mediaId: string;
  pricePoints: number;
  thumbnailUrl?: string | null;
}

export function LockedMediaCard({
  offer,
  conversationId,
  onUnlocked,
}: {
  offer: LockedMediaOffer;
  conversationId: string;
  onUnlocked: (imageUrl: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  async function unlock() {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      const r = await apiPost<{ imageUrl: string }>(
        `/companion-media/${offer.mediaId}/unlock`,
        { conversation_id: conversationId },
      );
      onUnlocked(r.imageUrl);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const code = err.payload.code;
        const msg = err.payload.message;
        if (code === 'E2010' || msg.includes('balance') || msg.includes('积分') || msg.includes('余额')) {
          setHint('心动值差一点点 · 添满再来宠她一下');
          setTimeout(() => router.push('/me/recharge?from=companion'), 900);
        } else {
          setHint('她有点害羞 · 稍后再试一次');
        }
      } else {
        setHint('她有点害羞 · 稍后再试一次');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[78%]">
      <div className="overflow-hidden rounded-2xl rounded-bl-md bg-white shadow-warm-xs">
        {/* 模糊预览区 · 有缩略图才显，否则暖色块占位 */}
        <div className="relative h-40 w-56">
          {offer.thumbnailUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={offer.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                style={{ filter: 'blur(16px)', transform: 'scale(1.1)' }}
                aria-hidden
              />
              <div className="absolute inset-0 bg-gradient-to-t from-primary/25 to-warm/15" />
            </>
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-primary-100 to-warm-100" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-warm-sm backdrop-blur">
              <Lock className="h-4 w-4 text-primary" />
            </span>
          </div>
        </div>
        {/* 文案 + 解锁 */}
        <div className="px-3 pb-3 pt-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-700">
            <Heart className="h-3 w-3 shrink-0 fill-primary text-primary" />
            <span>她有张照片想给你看…</span>
          </div>
          <button
            type="button"
            onClick={() => void unlock()}
            disabled={busy}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-cta py-2 text-[12.5px] font-medium text-white shadow-rose-md transition active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? (
              <span>她正在挑…</span>
            ) : (
              <>
                <span>为这段心动 · 添点温度</span>
                {offer.pricePoints > 0 && (
                  <span className="num rounded-full bg-white/20 px-1.5 text-[11px]">
                    {offer.pricePoints} 心动值
                  </span>
                )}
              </>
            )}
          </button>
          {hint && <div className="mt-1.5 text-center text-[10.5px] text-primary-600">{hint}</div>}
        </div>
      </div>
    </div>
  );
}
