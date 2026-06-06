/**
 * 私聊内 · 到店门店信息卡 ShopInfoCard(内联 · 仿 OrderOfferCard)
 *
 * 技师确认到店订单后,后端发一条 type='shop_info' 消息,payload(JSON):
 *   { orderNo, address, arrivalNote, guideMedia:[{url,kind,thumbnailUrl?,caption?}] }
 * 父在消息渲染 switch 里解析 JSON 后传 offer 进来。
 *
 * 复用 ShopInfoView 渲染地址(导航+复制)/ 指引媒体 / 到店须知。
 */
'use client';

import { Store } from 'lucide-react';
import { ShopInfoView, type ShopGuideMediaItem } from '@/components/shop/ShopInfoView';
import { t } from '@/lib/i18n';

export interface ShopInfoOffer {
  orderNo?: string | null;
  address: string | null;
  arrivalNote: string | null;
  guideMedia: ShopGuideMediaItem[];
}

export function ShopInfoCard({ offer }: { offer: ShopInfoOffer }) {
  const hasContent =
    !!offer.address?.trim() ||
    !!offer.arrivalNote?.trim() ||
    (Array.isArray(offer.guideMedia) && offer.guideMedia.length > 0);
  if (!hasContent) return null;

  return (
    <div className="w-[80%] max-w-[19rem] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-4 py-2.5">
        <Store className="h-4 w-4 text-primary" />
        <div>
          <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">{t('addr.shopCardTitle','到店地址 · 找店指引')}</div>
          {offer.orderNo && (
            <div className="mt-0.5 text-[10.5px] text-ink-400">{t('addr.orderNo','订单 {{no}}',{ no: offer.orderNo })}</div>
          )}
        </div>
      </div>

      <div className="p-3">
        <ShopInfoView
          info={{
            address: offer.address,
            arrivalNote: offer.arrivalNote,
            guideMedia: Array.isArray(offer.guideMedia) ? offer.guideMedia : [],
          }}
        />
        <div className="mt-2.5 text-[11px] leading-[1.5] text-ink-400">
          {t('addr.shopCardHint','到店前可以随时问我怎么走~门口见到你会很开心')}
        </div>
      </div>
    </div>
  );
}
