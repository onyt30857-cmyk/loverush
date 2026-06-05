/**
 * 心意礼物 BottomSheet · 客户在私聊送虚拟礼物给技师(0027 后改名 · 非"小费")
 *
 * 业务定位:加好感 + 表达心意 · 不是为购买服务付费 · 跟线下面付钱完全解耦
 *
 * 流程:
 *   1. 选 SKU(玫瑰 50 / 巧克力 100 / 奶茶 30 / 香水 300 / 项链 1k / 钻戒 5k)
 *   2. confirm 弹"送出 X · 扣 Y 积分?"
 *   3. POST /tips {therapist_id, gross_points, message:'送出 🌹 玫瑰花'}
 *   4. 成功 → 发气泡消息(系统消息样式) + 关 sheet + toast
 *   5. 失败(余额不足)→ 错误提示 + 留住 sheet
 *
 * 隐式闭环:
 *   - 后端 giveTip 自动扣客户积分 + 加技师积分(净额) + 平台抽佣
 *   - 后端发推送给技师(message 内含礼物名)
 */
'use client';

import { useState } from 'react';
import { X, Gift, Heart, Sparkles } from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/api';
import { useDialog } from '@/components/UIDialog';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';

export interface GiftSku {
  key: string;
  emoji: string;
  name: string;
  points: number;
  /** UI 渐变背景色调 */
  color: string;
  /** 一句"为啥送" hint */
  hint: string;
}

const GIFTS: GiftSku[] = [
  { key: 'lollipop', emoji: '🍭', name: '棒棒糖', points: 20, color: 'from-pink-100 to-rose-50', hint: '甜甜破冰' },
  { key: 'milktea', emoji: '🧋', name: '奶茶', points: 30, color: 'from-amber-100 to-amber-50', hint: '日常关心' },
  { key: 'rose', emoji: '🌹', name: '玫瑰花', points: 50, color: 'from-rose-100 to-rose-50', hint: '表达心意' },
  { key: 'choco', emoji: '🍫', name: '巧克力', points: 100, color: 'from-orange-100 to-amber-50', hint: '甜蜜小惊喜' },
  { key: 'perfume', emoji: '💄', name: '香水', points: 300, color: 'from-fuchsia-100 to-pink-50', hint: '节日好礼' },
  { key: 'necklace', emoji: '💎', name: '项链', points: 1000, color: 'from-cyan-100 to-blue-50', hint: '重磅心动' },
  { key: 'ring', emoji: '💍', name: '钻戒', points: 5000, color: 'from-violet-100 to-purple-50', hint: '顶配宠爱' },
];

export interface GiftSheetProps {
  isOpen: boolean;
  /** 技师 therapist.id(不是 user.id) */
  therapistId: string;
  /** 技师昵称 · 用于确认弹窗个性化 */
  therapistName?: string | null;
  /** 0027 · 技师默认法币 · 显示积分等值 fiat */
  therapistCurrencyCode?: string | null;
  /** 客户端拉的币种字典 · 用于换算显示 */
  currencies?: CurrencyMini[];
  onClose: () => void;
  /** 送出成功后回调 · 父组件触发发送一条"送出 X"系统气泡 */
  onSent: (sku: GiftSku) => void;
}

export function GiftSheet({
  isOpen,
  therapistId,
  therapistName,
  therapistCurrencyCode,
  currencies,
  onClose,
  onSent,
}: GiftSheetProps) {
  const { confirm, alert } = useDialog();
  const [busy, setBusy] = useState<string | null>(null); // 当前正在发送的 sku.key

  // 积分价换算为技师所属法币(无 currency 字典 / 无 rate fallback 显积分)
  const priceLabel = (points: number) =>
    pointsToFiatLabel(points, therapistCurrencyCode, currencies ?? []);

  if (!isOpen) return null;

  async function pickGift(sku: GiftSku) {
    if (busy) return;
    const who = therapistName || '她';
    const ok = await confirm({
      title: `送 ${sku.emoji} ${sku.name} 给 ${who}`,
      message: `扣 ${priceLabel(sku.points)} · ${sku.hint} · 立即送达`,
      confirmText: '送出',
    });
    if (!ok) return;
    setBusy(sku.key);
    try {
      await apiPost('/tips', {
        therapist_id: therapistId,
        gross_points: sku.points,
        timing: 'pre_service',
        message: `送出 ${sku.emoji} ${sku.name}`,
      });
      onSent(sku);
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError) {
        const msg = err.payload.message;
        if (msg.includes('balance') || msg.includes('积分') || err.payload.code === 'E2010') {
          await alert({ title: '余额不足', message: '快去充值再来宠她 · 或选个轻一点的礼物' });
        } else {
          await alert({ title: '送礼失败', message: msg });
        }
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[390px] max-h-[80vh] rounded-t-3xl bg-gradient-to-b from-white via-warm-50/30 to-white shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ink-200" />
        <div className="flex items-center justify-between px-5 pt-3 pb-1">
          <div>
            <h3 className="flex items-center gap-1.5 text-serif-cn text-base font-semibold text-ink-900">
              <Gift className="h-4 w-4 text-rose-500" strokeWidth={2.2} />
              送心意礼物给 {therapistName || '她'}
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-500">加好感 · 表达心意 · 她会立刻收到推送</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100/60 active:bg-ink-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4 text-ink-600" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5 px-5 pt-3 pb-6">
          {GIFTS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => void pickGift(g)}
              disabled={busy !== null}
              className={`group relative flex flex-col items-center gap-1 overflow-hidden rounded-2xl border border-warm-100 bg-gradient-to-br ${g.color} p-3 transition active:scale-95 disabled:opacity-50`}
            >
              {busy === g.key && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                  <Sparkles className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
              <span className="text-[28px] leading-none">{g.emoji}</span>
              <span className="font-serif-cn text-[13px] font-semibold text-ink-900">{g.name}</span>
              <span className="num text-[11px] font-bold text-primary">{priceLabel(g.points)}</span>
              <span className="text-[9.5px] text-ink-500">{g.hint}</span>
            </button>
          ))}
        </div>

        <div className="mx-5 mb-5 flex items-center justify-center gap-1.5 rounded-xl bg-warm-50/60 px-3 py-2 text-[10.5px] text-ink-500">
          <Heart className="h-3 w-3 fill-rose-300 text-rose-300" />
          <span>心意礼物 = 立刻加好感 · 跟服务费完全独立</span>
        </div>
      </div>
    </>
  );
}
