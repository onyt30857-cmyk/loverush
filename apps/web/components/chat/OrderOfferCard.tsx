/**
 * 对话内下单卡 · OrderOfferCard（内联·非 bottomsheet）
 *
 * 客户表达下单意图(分身自动推) 或 点「约今晚」(本地插) → 对话里出这张卡,
 * 内联列出技师服务套餐(时长+价格),客户点某个时长 → onPick(therapistId,duration)
 * → 父跳确认付款页 /therapist/[id]/order?duration=X。
 *
 * 价格渲染对齐 ServiceTierSheet:有 currencyCode+priceFiat 显法币「线下面付」,否则显积分。
 * 零交易硬词 · 首项 SIGNATURE。
 */
'use client';

import { ChevronRight } from 'lucide-react';
import type { PriceTier, CurrencyMini } from '@/components/ServiceTierSheet';

export interface OrderOffer {
  therapistId: string;
  therapistName: string | null;
  tiers: PriceTier[];
}

interface Props {
  offer: OrderOffer;
  /** 法币字典(格式化 priceFiat)；缺省全 fallback 积分 */
  currencies?: CurrencyMini[];
  onPick: (therapistId: string, duration: number) => void;
}

export function OrderOfferCard({ offer, currencies, onPick }: Props) {
  const tiers = Array.isArray(offer.tiers) ? offer.tiers : [];
  if (tiers.length === 0) return null;

  return (
    <div className="w-fit max-w-[80%] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      {/* 标题 */}
      <div className="border-b border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-4 py-2.5">
        <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">
          想约我的话，选个时长就好~
        </div>
        <div className="mt-0.5 text-[10.5px] text-ink-400">选好直接确认，不用去翻首页</div>
      </div>

      {/* 套餐列表 */}
      <div className="space-y-1.5 p-2.5">
        {tiers.map((p, i) => {
          const featured = i === 0;
          const cur = p.currencyCode ? currencies?.find((c) => c.code === p.currencyCode) : undefined;
          return (
            <button
              key={`${p.duration}-${i}`}
              type="button"
              onClick={() => onPick(offer.therapistId, p.duration)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
                featured
                  ? 'border-primary/30 bg-gradient-to-br from-primary/5 to-warm-50'
                  : 'border-warm-100 bg-white hover:border-warm-200'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-serif-cn text-[14px] font-semibold text-ink-900">
                    {p.duration} 分钟
                  </span>
                  {featured ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold tracking-wider"
                      style={{ background: 'rgba(255, 85, 119, 0.15)', color: '#FF5577' }}
                    >
                      SIGNATURE
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="text-right">
                {cur && p.priceFiat ? (
                  <>
                    <div
                      className="font-display num text-[17px] font-semibold leading-none"
                      style={{ color: featured ? '#FF5577' : '#1A1A2E' }}
                    >
                      {cur.symbol}
                      {p.priceFiat.toLocaleString('en-US', {
                        minimumFractionDigits: cur.decimals,
                        maximumFractionDigits: cur.decimals,
                      })}
                    </div>
                    <div className="mt-0.5 text-[8.5px] tracking-wider text-ink-400">线下面付</div>
                  </>
                ) : (
                  <>
                    <div
                      className="font-display num text-[17px] font-semibold leading-none"
                      style={{ color: featured ? '#FF5577' : '#1A1A2E' }}
                    >
                      {p.pricePoints}
                    </div>
                    <div className="mt-0.5 text-[8.5px] tracking-wider text-ink-400">积分</div>
                  </>
                )}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
