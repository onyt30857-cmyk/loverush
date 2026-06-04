/**
 * 私聊快捷操作条 · 输入框上方一行 chips(豆包风格)
 *
 * 4 个按钮(对技师业务价值排序):
 *   🎁 送礼物    → 弹 GiftSheet(6 SKU + 接 /tips)
 *   💝 约今晚    → 跳 /therapist/[id]/order(已有 M04)
 *   💬 找话题    → 弹 TopicSheet(LLM 生成 3 开场白)
 *   🔓 解锁联系  → confirm + POST /therapists/[id]/unlock
 *
 * 不在这里渲染 sheet · 只触发回调 · sheet 由父组件 (conversations/[id]/page) 控制
 */
'use client';

import { Gift, CalendarHeart, MessagesSquare, Lock, Heart } from 'lucide-react';

export interface QuickActionsBarProps {
  onGift: () => void;
  onBook: () => void;
  onTopics: () => void;
  onUnlock: () => void;
  /** M18 心动陪伴 · 打开亲密动作卡(可选 · 仅心动陪伴已开通时父组件传入) */
  onCompanion?: () => void;
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

export function QuickActionsBar({ onGift, onBook, onTopics, onUnlock, onCompanion, unlockDisabled }: QuickActionsBarProps) {
  const chips: ChipDef[] = [
    // M18 · "心动"放最前(最高情绪价值入口) · 仅心动陪伴开通时显示
    ...(onCompanion
      ? [{ key: 'companion', Icon: Heart, label: '心动', iconColor: 'text-primary-600', onClick: onCompanion }]
      : []),
    { key: 'gift', Icon: Gift, label: '心意礼物', iconColor: 'text-rose-500', onClick: onGift },
    { key: 'book', Icon: CalendarHeart, label: '约今晚', iconColor: 'text-primary', onClick: onBook },
    { key: 'topics', Icon: MessagesSquare, label: '找话题', iconColor: 'text-amber-500', onClick: onTopics },
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
