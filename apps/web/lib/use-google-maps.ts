'use client';

/**
 * Google Maps JS SDK 动态加载 · 0 npm 依赖
 *
 * 设计:
 *   - 只在首次需要时加载(用户进有地图的页面才下载 SDK)
 *   - 缓存到 window.google · 多组件复用
 *   - 缺 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 时 status='nokey'(组件优雅降级)
 */

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    google?: {
      maps?: {
        Map: new (el: HTMLElement, opts: unknown) => unknown;
        Marker: new (opts: unknown) => unknown;
        places: {
          Autocomplete: new (input: HTMLInputElement, opts?: unknown) => {
            addListener: (event: string, callback: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location: { lat: () => number; lng: () => number } };
              address_components?: Array<{
                long_name: string;
                short_name: string;
                types: string[];
              }>;
            };
          };
        };
      };
    };
    __loverush_maps_loading?: Promise<void>;
  }
}

export type MapsStatus = 'idle' | 'loading' | 'ready' | 'error' | 'nokey';

const SCRIPT_ID = 'loverush-google-maps-sdk';

function loadScript(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.google?.maps?.places) return Promise.resolve();
  if (window.__loverush_maps_loading) return window.__loverush_maps_loading;

  window.__loverush_maps_loading = new Promise<void>((resolve, reject) => {
    // 已加载 script 但仍未 ready · 等 callback
    if (document.getElementById(SCRIPT_ID)) {
      const timer = setInterval(() => {
        if (window.google?.maps?.places) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error('SDK init timeout'));
      }, 15_000);
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // SDK 加载完不保证 places ready(异步) · 轮询等
      const timer = setInterval(() => {
        if (window.google?.maps?.places) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(timer);
        reject(new Error('places lib timeout'));
      }, 10_000);
    };
    script.onerror = () => reject(new Error('script load failed'));
    document.head.appendChild(script);
  });

  return window.__loverush_maps_loading;
}

export function useGoogleMaps(): MapsStatus {
  const [status, setStatus] = useState<MapsStatus>('idle');

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) {
      setStatus('nokey');
      return;
    }
    if (typeof window !== 'undefined' && window.google?.maps?.places) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    loadScript(key)
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'));
  }, []);

  return status;
}
