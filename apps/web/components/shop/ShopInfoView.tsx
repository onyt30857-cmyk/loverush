/**
 * 到店服务 · 门店信息展示核心(共享)
 *
 * 订单详情 <ShopInfoSection> 和私聊 <ShopInfoCard> 共用这块渲染:
 *   📍 地址:可点导航 + 一键复制(即时反馈)
 *   🖼️ 指引媒体:图缩略点开大图 · 视频内联播放
 *   📝 到店须知文本
 *
 * 纯展示 · 无数据请求 · 字段全部由父传入。
 * 设计 token:warm/rose/ink · rounded-2xl · shadow-warm-*(对齐 INTERACTION-STANDARDS)。
 */
'use client';

import { useState } from 'react';
import { MapPin, Copy, Check, ImageOff } from 'lucide-react';
import { openMapNavigation } from '@/lib/mapLink';
import { t } from '@/lib/i18n';

export interface ShopGuideMediaItem {
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl?: string;
  caption?: string;
}

export interface ShopInfoData {
  address: string | null;
  arrivalNote: string | null;
  guideMedia: ShopGuideMediaItem[];
}

export function ShopInfoView({ info }: { info: ShopInfoData }) {
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<ShopGuideMediaItem | null>(null);

  const address = info.address?.trim() || '';
  const media = Array.isArray(info.guideMedia) ? info.guideMedia : [];
  const note = info.arrivalNote?.trim() || '';

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

  return (
    <div className="space-y-3">
      {/* 地址 · 可导航 + 复制 */}
      {address && (
        <div className="rounded-xl border border-warm-100 bg-warm-50/60 p-3">
          <button
            type="button"
            onClick={() => openMapNavigation(address)}
            className="flex w-full items-start gap-2 text-left transition active:scale-[0.99]"
          >
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-[13px] leading-[1.5] text-ink-800">{address}</span>
          </button>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => openMapNavigation(address)}
              className="flex-1 rounded-full bg-gradient-cta px-3 py-1.5 text-center text-[11.5px] font-medium text-white shadow-rose-md transition active:scale-95"
            >
              {t('addr.navigate', '导航前往')}
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
              {copied ? t('addr.copied','已复制') : t('addr.copy','复制地址')}
            </button>
          </div>
        </div>
      )}

      {/* 找店指引媒体 */}
      {media.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-ink-600">{t('addr.shopGuide','找店指引')}</div>
          <div className="grid grid-cols-3 gap-2">
            {media.map((m, i) => (
              <ShopMediaThumb key={`${m.url}-${i}`} item={m} onOpen={() => setLightbox(m)} />
            ))}
          </div>
        </div>
      )}

      {/* 到店须知 */}
      {note && (
        <div className="rounded-xl bg-ink-50 px-3 py-2.5">
          <div className="mb-1 text-[11px] font-medium text-ink-600">{t('addr.arrivalNote','到店须知')}</div>
          <div className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink-700">{note}</div>
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
              alt={lightbox.caption || '找店指引'}
              className="max-h-[85vh] max-w-full rounded-xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ShopMediaThumb({ item, onOpen }: { item: ShopGuideMediaItem; onOpen: () => void }) {
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
          <span className="text-[9px]">{t('addr.loadFailed','加载失败')}</span>
        </div>
      ) : thumb ? (
        <>
          {!loaded && <div className="absolute inset-0 animate-pulse bg-warm-100" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt={item.caption || '找店指引'}
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
