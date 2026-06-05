'use client';

/**
 * 命令式一次性取坐标 · 按需(按钮点击)用,不写偏好、不上报。
 *
 * 取坐标优先级(与 use-gps.ts 自动上报版同源,这里是 on-demand Promise 版):
 *   1) Telegram Mini App LocationManager(Bot API 8.0+)——TG 内置 webview 不给浏览器
 *      navigator.geolocation,必须走 TG 原生定位 API
 *   2) 浏览器 navigator.geolocation——普通网页 / 旧版 TG
 *   3) 都拿不到 → { ok:false, reason }
 *
 * 用于:下单页上门地址采集、发现页「附近」chip 等"现取现用本次坐标"的场景。
 */

export type CoordsResult =
  | { ok: true; lat: number; lng: number; accuracyM?: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'error' };

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

function getTgLocationManager(): TgLocationManager | null {
  if (typeof window === 'undefined') return null;
  const wa = (window as unknown as { Telegram?: { WebApp?: { LocationManager?: TgLocationManager } } }).Telegram?.WebApp;
  return wa?.LocationManager ?? null;
}

function viaBrowser(timeoutMs: number): Promise<CoordsResult> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, reason: 'unavailable' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      (err) =>
        resolve({ ok: false, reason: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/**
 * 取当前坐标。TG 环境优先走 LocationManager(带超时回退浏览器),否则直接浏览器。
 * 永不抛 · 失败返回 { ok:false, reason }。
 */
export function requestCoords(timeoutMs = 8000): Promise<CoordsResult> {
  const lm = getTgLocationManager();
  if (!lm) return viaBrowser(timeoutMs);

  return new Promise<CoordsResult>((resolve) => {
    let settled = false;
    const done = (r: CoordsResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    // TG 定位无响应 → 超时回退浏览器(再不行 viaBrowser 自身返回 unavailable)
    const timer = setTimeout(() => void viaBrowser(timeoutMs).then(done), timeoutMs);
    try {
      lm.init(() => {
        if (settled) return;
        if (lm.isLocationAvailable === false) {
          clearTimeout(timer);
          void viaBrowser(timeoutMs).then(done);
          return;
        }
        lm.getLocation((data) => {
          if (settled) return;
          clearTimeout(timer);
          if (data && typeof data.latitude === 'number') {
            done({ ok: true, lat: data.latitude, lng: data.longitude, accuracyM: data.horizontal_accuracy });
          } else {
            done({ ok: false, reason: 'denied' }); // 用户没授权 TG 定位
          }
        });
      });
    } catch {
      clearTimeout(timer);
      void viaBrowser(timeoutMs).then(done);
    }
  });
}
