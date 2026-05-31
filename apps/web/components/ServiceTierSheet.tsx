/**
 * 技师服务套餐快捷选择 · BottomSheet
 *
 * 用法:
 *   点详情页底部"锁定她"按钮 · 弹出列出所有 basePriceJson tier
 *   用户选一个 → onSelect(duration) → 父跳 /therapist/[id]/order?duration=X
 *
 * 设计对齐 FilterBottomSheet · 复用 .chip / btn-primary 样式
 * 无套餐时显空态 + "联系技师"兜底
 */
'use client';

import { useEffect } from 'react';
import { X, Heart, ChevronRight } from 'lucide-react';

export interface PriceTier {
  duration: number;
  pricePoints: number;
}

interface Props {
  isOpen: boolean;
  /** 技师昵称(标题用)*/
  therapistName: string | null;
  priceTiers: PriceTier[];
  /** 可选:标签(显在每个 tier 下面) */
  tags?: string[];
  onClose: () => void;
  /** 用户选了某个 tier */
  onSelect: (duration: number) => void;
  /** 无套餐时点"先聊聊"的兜底回调 */
  onFallbackChat?: () => void;
}

export function ServiceTierSheet({
  isOpen,
  therapistName,
  priceTiers,
  tags,
  onClose,
  onSelect,
  onFallbackChat,
}: Props) {
  // 锁 body 滚动
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const subtitle = tags && tags.length ? tags.slice(0, 3).join(' · ') : '基础套餐 · 一客一换';

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-label="关闭套餐选择"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择服务套餐"
        className="absolute inset-x-0 bottom-0 z-50 max-h-[85%] overflow-hidden rounded-t-3xl bg-white shadow-2xl animate-slide-up"
      >
        {/* 顶部 grab handle + 标题 */}
        <div className="sticky top-0 z-10 bg-white pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-200" />
          <div className="flex items-start justify-between border-b border-warm-100 px-5 pb-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-serif-cn text-[16px] font-semibold text-ink-900 truncate">
                {therapistName ?? '技师'} 的服务
              </h2>
              <div className="font-cormorant italic text-[10px] text-ink-400 tracking-[0.3em] mt-0.5">
                CHOOSE YOUR TIME
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-ink-50 active:bg-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 套餐列表 */}
        <div className="max-h-[60vh] overflow-y-auto px-4 pt-3 pb-5">
          {priceTiers.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warm-50">
                <Heart className="h-6 w-6 text-warm-400" />
              </div>
              <div className="mt-3 font-serif-cn text-[14px] font-semibold text-ink-800">
                还没设置套餐
              </div>
              <div className="mt-1 text-[11px] text-ink-500">
                直接私聊她,确认时长和价格
              </div>
              {onFallbackChat ? (
                <button
                  type="button"
                  onClick={onFallbackChat}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-cta px-5 py-2 text-[12.5px] font-medium text-white shadow-rose-md active:scale-95"
                >
                  去私聊 →
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2.5">
              {priceTiers.map((p, i) => {
                const featured = i === 0;
                return (
                  <button
                    key={`${p.duration}-${i}`}
                    type="button"
                    onClick={() => {
                      onSelect(p.duration);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition active:scale-[0.98] ${
                      featured
                        ? 'border-primary/30 bg-gradient-to-br from-primary/5 to-warm-50 shadow-rose-md'
                        : 'border-warm-100 bg-white hover:border-warm-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-serif-cn text-[15px] font-semibold text-ink-900">
                          {p.duration} 分钟
                        </div>
                        {featured ? (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-wider"
                            style={{ background: 'rgba(255, 85, 119, 0.15)', color: '#FF5577' }}
                          >
                            SIGNATURE
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-500">{subtitle}</div>
                    </div>
                    <div className="text-right">
                      <div
                        className="font-display num text-[20px] font-semibold leading-none"
                        style={{ color: featured ? '#FF5577' : '#1A1A2E' }}
                      >
                        {p.pricePoints}
                      </div>
                      <div className="mt-0.5 text-[9px] tracking-wider text-ink-400">积分</div>
                    </div>
                    <ChevronRight className="ml-1 h-4 w-4 text-ink-300" />
                  </button>
                );
              })}

              <div className="mt-3 rounded-xl bg-warm-50/60 px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-500">
                选完直接进入确认页 · 锁定她不让别人抢走
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
