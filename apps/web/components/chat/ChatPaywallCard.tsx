/**
 * 陪聊软墙卡 · ChatPaywallCard(内联)
 *
 * 免费额度用完时,系统浮这张卡(分身不硬断,机会成本撒娇)。客户点一档时长 →
 * 买陪聊时段(扣积分+技师分成+建倒计时 session) → onPurchased(开始倒计时,她恢复畅聊)。
 *
 * 文案铁律:机会成本撒娇("陪你聊就接不了单啦")、零交易词、留自由感("不养也没关系")。
 */
'use client';

import { useState } from 'react';
import { Clock, Heart } from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/api';

export interface ChatPaywallOffer {
  therapistName: string | null;
  options: Array<{ minutes: number; points: number }>;
}

interface Props {
  offer: ChatPaywallOffer;
  /** 技师 user_id(买 session 路由用,从 conv 传入) */
  therapistUserId: string;
  onPurchased: (expireAt: string, minutes: number) => void;
  onInsufficient: () => void;
}

export function ChatPaywallCard({ offer, therapistUserId, onPurchased, onInsufficient }: Props) {
  const who = offer.therapistName || '她';
  const [busy, setBusy] = useState<number | null>(null);

  async function buy(minutes: number) {
    if (busy !== null) return;
    setBusy(minutes);
    try {
      const idempotency_key =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${therapistUserId}.${minutes}.${Date.now()}`;
      const r = await apiPost<{ expireAt: string }>(`/chat-pass/${therapistUserId}/session`, {
        duration_minutes: minutes,
        idempotency_key,
      });
      onPurchased(r.expireAt, minutes);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const msg = err.payload.message;
        if (err.payload.code === 'E2010' || msg.includes('balance') || msg.includes('积分') || msg.includes('余额')) {
          onInsufficient();
          return;
        }
      }
      // 其他错误静默(不打断情绪)
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-fit max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-warm-50">
          <Heart className="h-4.5 w-4.5 fill-primary text-primary" />
        </div>
        <div className="min-w-0">
          <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">想多陪你一会儿~</div>
          <div className="mt-0.5 text-[10.5px] text-ink-400">陪你聊就接不了单啦，养养{who}嘛~</div>
        </div>
      </div>
      <div className="space-y-1.5 px-3 pb-2">
        {offer.options.map((o) => (
          <button
            key={o.minutes}
            type="button"
            onClick={() => void buy(o.minutes)}
            disabled={busy !== null}
            className="flex w-full items-center justify-between rounded-xl border border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-3.5 py-2.5 text-left transition active:scale-[0.98] disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-800">
              <Clock className="h-3.5 w-3.5 text-primary" />
              陪你聊 {o.minutes} 分钟
            </span>
            <span className="num text-[13px] font-semibold text-primary">
              {busy === o.minutes ? '…' : `${o.points} 积分`}
            </span>
          </button>
        ))}
      </div>
      <div className="px-4 pb-3 pt-0.5 text-center text-[10px] text-ink-400">不养也没关系，明天我还在这儿等你~</div>
    </div>
  );
}
