'use client';

/**
 * GPS 定位 hook · Phase 1 距离排序
 *
 * 设计:
 *   - 只在用户授权后获取(浏览器 prompt · 不能强求)
 *   - 拒绝过 24h 内不再问(localStorage 标记)
 *   - 成功后 POST /me/location/gps 上报(后端用于距离排序)
 *   - 缓存到 sessionStorage(同 session 内不重复请求)
 *
 * 隐私:
 *   - 客户端 GPS 永不显示给技师
 *   - 后端只返回 distance_km(整数 km),不返原始坐标
 */

import { useEffect, useState } from 'react';
import { mutate as swrMutate } from 'swr';
import { apiPatch } from './api';

const SESSION_KEY = 'gps_uploaded_at';
const DENIED_KEY = 'gps_denied_at';
const REQUEST_INTERVAL_MS = 24 * 3600 * 1000; // deny 24h 不再骚扰
const SUCCESS_REUPLOAD_MS = 5 * 60 * 1000; // 上报成功 5min 内不重发(防同次刷新爆量)

export interface GpsState {
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'error';
  coords: { lat: number; lng: number } | null;
  error?: string;
}

/**
 * 自动 GPS 上报 hook
 * @param autoRequest 是否自动询问(默认 true · 设 false 由 UI 按钮触发)
 */
export function useGpsAutoUpload(autoRequest = true): GpsState {
  const [state, setState] = useState<GpsState>({ status: 'idle', coords: null });

  useEffect(() => {
    if (!autoRequest) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'unavailable', coords: null });
      return;
    }

    // 上报成功 5min 内不重发(防同次刷新爆量)· 之后允许重新触发(刷新页面/二次进 home)
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

    setState({ status: 'requesting', coords: null });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try {
          // Phase 2 · resolve_area=true 让后端用 Google Geocoding 自动匹配 city/area 字典
          // 注意路由: meLocationRoutes 挂在 /me/location-preference(不是 /me/location)
          await apiPatch('/me/location-preference/gps', {
            lat: coords.lat,
            lng: coords.lng,
            accuracy_m: Math.round(pos.coords.accuracy),
            resolve_area: true,
          });
          sessionStorage.setItem(SESSION_KEY, String(Date.now()));
          localStorage.removeItem(DENIED_KEY);
          // 触发 SWR 刷新 home page 顶部位置 chip(立即显示新城市名)
          void swrMutate('/me/location-preference');
          setState({ status: 'granted', coords });
        } catch (e) {
          setState({
            status: 'error',
            coords,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          localStorage.setItem(DENIED_KEY, String(Date.now()));
          setState({ status: 'denied', coords: null, error: 'permission denied' });
        } else {
          setState({ status: 'error', coords: null, error: err.message });
        }
      },
      {
        enableHighAccuracy: false, // 节电 · IP 估算亦可(几公里粒度够推荐用)
        timeout: 8000,
        maximumAge: 30 * 60 * 1000, // 30min cache · 同位置反复 query 不耗电
      },
    );
  }, [autoRequest]);

  return state;
}
