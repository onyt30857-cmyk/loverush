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
  /** M02 Phase 5.1 · 该城市通过 verification 的技师数 */
  therapistCount: number;
}

export interface GeoArea {
  id: string;
  code: string;
  cityId: string;
  name: string;
  /** M02 Phase 5.1 · 该区域通过 verification 的技师数 */
  therapistCount: number;
}

export interface GeoCountry {
  country: string;
  flag: string;
  label: string;
  cityCount: number;
  therapistCount: number;
}

export function useLocationPref(): { pref: LocationPref | null; mutate: () => Promise<unknown> } {
  const { data, mutate } = useSWR<LocationPref | null>(
    '/me/location-preference',
    (url: string) => apiGet<LocationPref | null>(url).catch(() => null),
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  return { pref: data ?? null, mutate };
}

/** 拉所有可选城市(全国 · 默认按 sortOrder 升序) · 5 min 缓存(技师数变化不会秒级) */
export function useCities(country?: string): { cities: GeoCity[] } {
  const url = country ? `/geo/cities?country=${country}` : '/geo/cities';
  const { data } = useSWR<GeoCity[]>(url, (u: string) => apiGet<GeoCity[]>(u).catch(() => []), {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  });
  return { cities: data ?? [] };
}

/** M02 Phase 5.1 · 国家维度聚合 · 用于 sheet 分组 header 显总数 */
export function useCountries(): { countries: GeoCountry[] } {
  const { data } = useSWR<GeoCountry[]>(
    '/geo/countries',
    (u: string) => apiGet<GeoCountry[]>(u).catch(() => []),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );
  return { countries: data ?? [] };
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
