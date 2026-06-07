/**
 * 私聊快捷操作条 · 输入框上方一行 chips(豆包风格)
 *
 * 交易导向(撮合平台核心=促成线下成交,C 位给"约今晚"):
 *   💝 约今晚    → 就地插下单卡(M04)
 *   💬 找话题    → 弹 TopicSheet(LLM 生成 3 开场白 · 降开口门槛)
 *   🎁 心意礼物  → 弹 GiftSheet(给真人技师打赏)
 *   🔓 解锁联系  → confirm + POST /therapists/[id]/unlock
 *
 * 不在这里渲染 sheet · 只触发回调 · sheet 由父组件 (conversations/[id]/page) 控制
 */
'use client';

import { Gift, CalendarHeart, MessagesSquare, Lock } from 'lucide-react';

export interface QuickActionsBarProps {
  onGift: () => void;
  onBook: () => void;
  onTopics: () => void;
  onUnlock: () => void;
  /** 解锁按钮是否禁用(已解锁过) */
  unlockDisabled?: boolean;
}

interface ChipDef {
  key: string;
  Icon: typeof Gift;
  label: string;
  iconColor: string;
  onClick: () => void;
  disabled?: boolean;
}

export function QuickActionsBar({ onGift, onBook, onTopics, onUnlock, unlockDisabled }: QuickActionsBarProps) {
  const chips: ChipDef[] = [
    // 交易优先:约今晚放 C 位(促成线下成交是核心)
    { key: 'book', Icon: CalendarHeart, label: '约今晚', iconColor: 'text-primary', onClick: onBook },
    { key: 'topics', Icon: MessagesSquare, label: '找话题', iconColor: 'text-amber-500', onClick: onTopics },
    { key: 'gift', Icon: Gift, label: '心意礼物', iconColor: 'text-rose-500', onClick: onGift },
    {
      key: 'unlock',
      Icon: Lock,
      label: '解锁联系',
      iconColor: 'text-emerald-600',
      onClick: onUnlock,
      disabled: unlockDisabled,
    },
  ];

  return (
    <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1.5">
      {chips.map(({ key, Icon, label, iconColor, onClick, disabled }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border border-warm-100 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-warm-xs transition active:scale-95 active:bg-warm-50 disabled:opacity-50 disabled:active:scale-100`}
        >
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} strokeWidth={2.2} />
          <span className="whitespace-nowrap">{label}</span>
        </button>
      ))}
    </div>
  );
}
