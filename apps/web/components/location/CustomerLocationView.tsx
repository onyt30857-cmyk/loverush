/**
 * 上门服务 · 客户地址展示核心(共享 · 到店 ShopInfoView 的镜像)
 *
 * 三处共用这块渲染:
 *   - 客户订单详情(order/[id]):自己看自己填的完整地址(核对)
 *   - 技师订单详情(t/orders/[id]):确认前看大致区域+距离 / LOCKED 后看完整地址+导航
 *   - 技师私聊卡(CustomerLocationCard):确认后投递的完整地址
 *
 * 两态:
 *   full=true  → 📍完整地址(导航+复制) + 🏷️找路指引 + 🖼️楼栋照
 *   full=false → 仅【大致区域 + 约 N km】(确认前技师只见这些,绝不漏门牌)
 *
 * 纯展示 · 无数据请求 · 字段全部由父传入。
 * 设计 token:warm/rose/ink · rounded-2xl · shadow-warm-*(对齐 INTERACTION-STANDARDS)。
 */
'use client';

import { useState } from 'react';
import { MapPin, Copy, Check, ImageOff, Navigation } from 'lucide-react';
import { openMapNavigation } from '@/lib/mapLink';

export interface CustomerLocationMediaItem {
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl?: string;
  caption?: string;
}

export interface CustomerLocationData {
  areaName: string | null;
  address: string | null;
  note: string | null;
  media: CustomerLocationMediaItem[];
  distanceKm: number | null;
  /** true=完整(LOCKED+ 或客户自见)· false=仅大致区域(确认前技师) */
  full: boolean;
}

function fmtDistance(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 1) return `约 ${Math.max(1, Math.round(km * 1000))} m`;
  return `约 ${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function CustomerLocationView({ info }: { info: CustomerLocationData }) {
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<CustomerLocationMediaItem | null>(null);

  const areaName = info.areaName?.trim() || '';
  const address = info.address?.trim() || '';
  const note = info.note?.trim() || '';
  const media = Array.isArray(info.media) ? info.media : [];
  const distanceLabel = fmtDistance(info.distanceKm);

  async function copyAddress() {
    if (!address) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        // 兜底:老浏览器/非安全上下文
        const ta = document.createElement('textarea');
        ta.value = address;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 复制失败静默 · 地址仍可手动选中
    }
  }

  // 确认前:技师只见大致区域 + 距离(绝不漏门牌)
  if (!info.full) {
    return (
      <div className="rounded-xl border border-warm-100 bg-warm-50/60 p-3">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1">
            <div className="text-[13px] font-medium text-ink-800">
              {areaName || '客户已填写上门地址'}
              {distanceLabel && <span className="ml-1.5 text-[12px] font-normal text-ink-500">· {distanceLabel}</span>}
            </div>
            <div className="mt-1 text-[11px] leading-[1.5] text-ink-500">
              确认接单后,客户的完整门牌 + 找路指引才会解锁给你
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 完整地址 · 可导航 + 复制 */}
      {address ? (
        <div className="rounded-xl border border-warm-100 bg-warm-50/60 p-3">
          <button
            type="button"
            onClick={() => openMapNavigation(address)}
            className="flex w-full items-start gap-2 text-left transition active:scale-[0.99]"
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-[13px] leading-[1.5] text-ink-800">{address}</span>
          </button>
          {(areaName || distanceLabel) && (
            <div className="mt-1.5 pl-6 text-[11px] text-ink-500">
              {[areaName, distanceLabel].filter(Boolean).join(' · ')}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => openMapNavigation(address)}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-gradient-cta px-3 py-1.5 text-center text-[11.5px] font-medium text-white shadow-rose-md transition active:scale-95"
            >
              <Navigation className="h-3.5 w-3.5" />
              导航上门
            </button>
            <button
              type="button"
              onClick={() => void copyAddress()}
              className={`flex items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition active:scale-95 ${
                copied
                  ? 'border-success-500/40 bg-success-500/5 text-success-500'
                  : 'border-warm-200 bg-white text-ink-700'
              }`}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已复制' : '复制地址'}
            </button>
          </div>
        </div>
      ) : (
        // full=true 但地址为空(客户只放了 GPS 落点)· 仍给区域兜底
        (areaName || distanceLabel) && (
          <div className="rounded-xl border border-warm-100 bg-warm-50/60 p-3">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 text-[13px] text-ink-800">
                {[areaName, distanceLabel].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        )
      )}

      {/* 找路指引文本 */}
      {note && (
        <div className="rounded-xl bg-ink-50 px-3 py-2.5">
          <div className="mb-1 text-[11px] font-medium text-ink-600">找路指引</div>
          <div className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink-700">{note}</div>
        </div>
      )}

      {/* 楼栋照 */}
      {media.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-ink-600">楼栋 / 门牌照</div>
          <div className="grid grid-cols-3 gap-2">
            {media.map((m, i) => (
              <LocationMediaThumb key={`${m.url}-${i}`} item={m} onOpen={() => setLightbox(m)} />
            ))}
          </div>
        </div>
      )}

      {/* 大图 / 视频 lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          {lightbox.kind === 'video' ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              playsInline
              className="max-h-[85vh] max-w-full rounded-xl bg-black"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.url}
              alt={lightbox.caption || '楼栋照'}
              className="max-h-[85vh] max-w-full rounded-xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LocationMediaThumb({
  item,
  onOpen,
}: {
  item: CustomerLocationMediaItem;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const thumb = item.thumbnailUrl || (item.kind === 'image' ? item.url : undefined);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-square overflow-hidden rounded-xl border border-warm-100 bg-warm-50 transition active:scale-95"
    >
      {failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-300">
          <ImageOff className="h-5 w-5" />
          <span className="text-[9px]">加载失败</span>
        </div>
      ) : thumb ? (
        <>
          {!loaded && <div className="absolute inset-0 animate-pulse bg-warm-100" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt={item.caption || '楼栋照'}
            className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        // 视频无缩略图 · 显占位底
        <div className="h-full w-full bg-ink-800" />
      )}

      {/* 视频角标 */}
      {item.kind === 'video' && !failed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white">▶</div>
        </div>
      )}

      {/* caption */}
      {item.caption && !failed && (
        <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-3 text-left text-[9px] text-white">
          {item.caption}
        </div>
      )}
    </button>
  );
}
