'use client';

/**
 * 小地图 · 详情页底部嵌入显示服务区域
 *
 * 隐私设计:
 *   - 显示城市/区中心 + 大半径圆(模糊范围)· 不显示精确点
 *   - 地图禁用拖动/缩放(防破解精确位置)· readonly 静态视角
 *   - 缺 API key 时降级为文字 "X 区"
 */

import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/lib/use-google-maps';
import { MapPin } from 'lucide-react';

export interface MiniMapProps {
  /** 中心 lat */
  lat: number | string | null | undefined;
  /** 中心 lng */
  lng: number | string | null | undefined;
  /** 显示文案(区域/城市名 · 兜底无地图时显示) */
  label?: string | null;
  /** 高度 px · 默认 140 */
  height?: number;
}

export function MiniMap({ lat, lng, label, height = 140 }: MiniMapProps) {
  const mapsStatus = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement>(null);
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lngNum = typeof lng === 'string' ? parseFloat(lng) : lng;
  const hasCoords =
    latNum != null && lngNum != null && Number.isFinite(latNum) && Number.isFinite(lngNum);

  useEffect(() => {
    if (mapsStatus !== 'ready' || !containerRef.current || !hasCoords) return;
    const g = window.google?.maps;
    if (!g) return;

    const center = { lat: latNum as number, lng: lngNum as number };
    // 静态视角 · 禁交互防破解精确位置
    new g.Map(containerRef.current, {
      center,
      zoom: 12, // 街区级别 · 看得到大概位置但看不清门牌
      disableDefaultUI: true,
      gestureHandling: 'none',
      keyboardShortcuts: false,
      clickableIcons: false,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });
    // 模糊范围 marker(用 emoji 代替精确 pin)
    new g.Marker({
      position: center,
      // 用一个圆形 SVG · 暗示"区域"而非"精确点"
      icon: {
        path: 'M 0,0 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0',
        fillColor: '#FF5577',
        fillOpacity: 0.25,
        strokeColor: '#FF5577',
        strokeWeight: 2,
        scale: 1,
      },
    });
  }, [mapsStatus, hasCoords, latNum, lngNum]);

  // 缺 key / 错 / 没坐标:文字降级
  if (mapsStatus === 'nokey' || mapsStatus === 'error' || !hasCoords) {
    return (
      <div
        className="flex items-center gap-2 rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-700"
        style={{ minHeight: 48 }}
      >
        <MapPin className="h-4 w-4 text-primary" />
        <span>{label ?? '服务区域'}</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-warm-100 bg-white">
      <div
        ref={containerRef}
        style={{ width: '100%', height }}
        className={mapsStatus === 'loading' ? 'animate-pulse bg-ink-100' : ''}
      />
      {label && (
        <div className="border-t border-warm-100 px-3 py-1.5 text-[11px] text-ink-600">
          <MapPin className="mr-1 inline h-3 w-3 text-primary" />
          {label} · 大致区域 · 实际位置预约后告知
        </div>
      )}
    </div>
  );
}
