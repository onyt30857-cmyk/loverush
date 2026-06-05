/**
 * 私聊内 · 上门客户地址卡 CustomerLocationCard(到店 ShopInfoCard 的镜像)
 *
 * 技师确认上门订单(LOCKED)后,后端给【技师】会话发一条 type='customer_location' 消息,
 * payload(JSON):{ orderNo, address, note, areaName, media:[{url,kind,thumbnailUrl?,caption?}] }
 * 父在消息渲染 switch 里解析 JSON 后传 offer 进来。
 *
 * 这张卡只发给技师看(后端控可见性)· 已 LOCKED → 完整地址,full 恒为 true。
 * 复用 CustomerLocationView 渲染地址(导航+复制)/ 找路指引 / 楼栋照。
 */
'use client';

import { Home } from 'lucide-react';
import {
  CustomerLocationView,
  type CustomerLocationMediaItem,
} from '@/components/location/CustomerLocationView';

export interface CustomerLocationOffer {
  orderNo?: string | null;
  areaName: string | null;
  address: string | null;
  note: string | null;
  media: CustomerLocationMediaItem[];
  lat?: string | null;
  lng?: string | null;
}

export function CustomerLocationCard({ offer }: { offer: CustomerLocationOffer }) {
  const hasContent =
    !!offer.address?.trim() ||
    !!offer.note?.trim() ||
    !!offer.areaName?.trim() ||
    (Array.isArray(offer.media) && offer.media.length > 0);
  if (!hasContent) return null;

  return (
    <div className="w-fit max-w-[82%] overflow-hidden rounded-2xl rounded-bl-md border border-warm-100 bg-white shadow-warm-xs">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-warm-100 bg-gradient-to-br from-primary/5 to-warm-50 px-4 py-2.5">
        <Home className="h-4 w-4 text-primary" />
        <div>
          <div className="font-serif-cn text-[13.5px] font-semibold text-ink-800">客户上门地址 · 找路指引</div>
          {offer.orderNo && (
            <div className="mt-0.5 text-[10.5px] text-ink-400">订单 {offer.orderNo}</div>
          )}
        </div>
      </div>

      <div className="p-3">
        <CustomerLocationView
          info={{
            areaName: offer.areaName,
            address: offer.address,
            note: offer.note,
            media: Array.isArray(offer.media) ? offer.media : [],
            distanceKm: null,
            lat: offer.lat ?? null,
            lng: offer.lng ?? null,
            full: true,
          }}
        />
        <div className="mt-2.5 text-[11px] leading-[1.5] text-ink-400">
          按地址导航过去 · 找不到楼栋随时问客户~
        </div>
      </div>
    </div>
  );
}
