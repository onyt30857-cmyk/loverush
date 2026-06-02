'use client';

/**
 * GPS 定位 hook · Phase 1 距离排序
 *
 * 取坐标优先级：
 *   1) Telegram Mini App 的 LocationManager(Bot API 8.0+)——TG 内置 webview 不给
 *      浏览器 navigator.geolocation，必须走 TG 原生定位 API
 *   2) 浏览器 navigator.geolocation——普通网页/旧版 TG
 *   3) 都拿不到 → status='unavailable' → 首页引导手动选城市(不阻塞)
 *
 * 设计：拒绝过 24h 内不再问；成功后上报后端用于距离排序；同 session 5min 不重发。
 * 隐私：客户端 GPS 永不显示给技师；后端只返回 distance_km。
 */

import { useEffect, useState } from 'react';
import { mutate as swrMutate } from 'swr';
import { apiPatch } from './api';

const SESSION_KEY = 'gps_uploaded_at';
const DENIED_KEY = 'gps_denied_at';
const REQUEST_INTERVAL_MS = 24 * 3600 * 1000;
const SUCCESS_REUPLOAD_MS = 5 * 60 * 1000;

export interface GpsState {
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'error';
  coords: { lat: number; lng: number } | null;
  error?: string;
}

// TG Mini App LocationManager 最小类型(避免动 Window 全局声明，局部 cast 取用)
interface TgLocationData {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
}
interface TgLocationManager {
  init: (cb?: () => void) => void;
  getLocation: (cb: (data: TgLocationData | null) => void) => void;
  isLocationAvailable?: boolean;
}
interface TgWebAppLike {
  LocationManager?: TgLocationManager;
}

function getTgLocationManager(): TgLocationManager | null {
  if (typeof window === 'undefined') return null;
  const wa = (window as unknown as { Telegram?: { WebApp?: TgWebAppLike } }).Telegram?.WebApp;
  return wa?.LocationManager ?? null;
}

export function useGpsAutoUpload(autoRequest = true): GpsState {
  const [state, setState] = useState<GpsState>({ status: 'idle', coords: null });

  useEffect(() => {
    if (!autoRequest) return;
    if (typeof window === 'undefined') return;

    // 上报成功 5min 内不重发
    const lastUploaded = sessionStorage.getItem(SESSION_KEY);
    if (lastUploaded && Date.now() - parseInt(lastUploaded, 10) < SUCCESS_REUPLOAD_MS) {
      setState({ status: 'granted', coords: null });
      return;
    }
    // 24h 内拒绝过 → 不骚扰
    const deniedAt = localStorage.getItem(DENIED_KEY);
    if (deniedAt && Date.now() - parseInt(deniedAt, 10) < REQUEST_INTERVAL_MS) {
      setState({ status: 'denied', coords: null });
      return;
    }

    let cancelled = false;

    async function uploadCoords(lat: number, lng: number, accuracyM?: number) {
      const coords = { lat, lng };
      try {
        await apiPatch('/me/location-preference/gps', {
          lat,
          lng,
          accuracy_m: accuracyM != null ? Math.round(accuracyM) : undefined,
          resolve_area: true,
        });
        sessionStorage.setItem(SESSION_KEY, String(Date.now()));
        localStorage.removeItem(DENIED_KEY);
        void swrMutate('/me/location-preference');
        if (!cancelled) setState({ status: 'granted', coords });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', coords, error: e instanceof Error ? e.message : String(e) });
      }
    }

    function viaBrowser() {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setState({ status: 'unavailable', coords: null });
        return;
      }
      setState({ status: 'requesting', coords: null });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          void uploadCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        (err) => {
          if (cancelled) return;
          if (err.code === err.PERMISSION_DENIED) {
            localStorage.setItem(DENIED_KEY, String(Date.now()));
            setState({ status: 'denied', coords: null, error: 'permission denied' });
          } else {
            // TG 等 webview 常报 unavailable → 触发首页手动选城市兜底
            setState({ status: 'unavailable', coords: null, error: err.message });
          }
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
      );
    }

    // 优先 TG LocationManager
    const lm = getTgLocationManager();
    if (lm) {
      setState({ status: 'requesting', coords: null });
      try {
        lm.init(() => {
          if (cancelled) return;
          if (lm.isLocationAvailable === false) {
            viaBrowser();
            return;
          }
          lm.getLocation((data) => {
            if (cancelled) return;
            if (data && typeof data.latitude === 'number') {
              void uploadCoords(data.latitude, data.longitude, data.horizontal_accuracy);
            } else {
              // 用户没授权 TG 定位 → 不强求，置 unavailable 让首页引导手动选城市
              setState({ status: 'unavailable', coords: null, error: 'tg location not granted' });
            }
          });
        });
      } catch {
        viaBrowser();
      }
      return () => {
        cancelled = true;
      };
    }

    viaBrowser();
    return () => {
      cancelled = true;
    };
  }, [autoRequest]);

  return state;
}
