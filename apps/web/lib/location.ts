/**
 * 客户位置偏好 hook · M02 Phase 5
 *
 * 拉 GET /me/location-preference · SWR 缓存
 * 提供 setLocation 写入(PUT 同端点)
 *
 * 失败兜底返 null · home/搜索都安全降级
 */
'use client';

import useSWR from 'swr';
import { apiGet, apiPut } from './api';

export interface LocationPref {
  cityId: string | null;
  cityCode: string | null;
  cityName: string | null;
  areaId: string | null;
  areaCode: string | null;
  areaName: string | null;
  source: string;
  updatedAt: string;
}

export interface GeoCity {
  id: string;
  code: string;
  country: string;
  name: string;
}

export interface GeoArea {
  id: string;
  code: string;
  cityId: string;
  name: string;
}

export function useLocationPref(): { pref: LocationPref | null; mutate: () => Promise<unknown> } {
  const { data, mutate } = useSWR<LocationPref | null>(
    '/me/location-preference',
    (url: string) => apiGet<LocationPref | null>(url).catch(() => null),
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  return { pref: data ?? null, mutate };
}

/** 拉所有可选城市(全国 · 默认按 sortOrder 升序) */
export function useCities(country?: string): { cities: GeoCity[] } {
  const url = country ? `/geo/cities?country=${country}` : '/geo/cities';
  const { data } = useSWR<GeoCity[]>(url, (u: string) => apiGet<GeoCity[]>(u).catch(() => []), {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  return { cities: data ?? [] };
}

export function useAreas(cityId: string | null): { areas: GeoArea[] } {
  const { data } = useSWR<GeoArea[]>(
    cityId ? `/geo/cities/${cityId}/areas` : null,
    (u: string) => apiGet<GeoArea[]>(u).catch(() => []),
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  return { areas: data ?? [] };
}

/** 写入偏好 · 失败抛错 · home 端 await 后 mutate */
export async function setLocationPref(args: {
  cityId: string | null;
  areaId?: string | null;
  source?: 'manual' | 'inferred' | 'gps_resolved';
}): Promise<void> {
  await apiPut('/me/location-preference', {
    city_id: args.cityId,
    area_id: args.areaId ?? null,
    source: args.source ?? 'manual',
  });
}
