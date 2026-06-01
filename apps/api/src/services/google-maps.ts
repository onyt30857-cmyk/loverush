/**
 * Google Maps API 集成 · 后端
 *
 * - reverseGeocode:GPS → 详细地址 components(country/city/area/postal)
 * - 缺 GOOGLE_MAPS_API_KEY 时 noop · 返 null(不抛错)
 * - 失败只 log 不抛 · 避免依赖外部 API 拖垮主链
 */

import { loadEnv } from '../env';
import { logger } from './logger';

export interface GeocodeResult {
  /** 完整地址 */
  formatted: string;
  /** 国家 ISO-3166 alpha-2(如 'TH' / 'CN' / 'US') */
  countryCode: string | null;
  /** 城市英文名(粗粒度 · 如 'Bangkok' / 'Singapore') */
  city: string | null;
  /** 区/区域英文名(细粒度 · 如 'Asok' / 'Orchard') */
  area: string | null;
  /** lat/lng 回写(Google 校准过的) */
  lat: number;
  lng: number;
}

/**
 * 反向地理编码 · GPS → 地址
 * 失败/key 缺/无结果都返 null · 永不抛
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<GeocodeResult | null> {
  const env = loadEnv();
  if (!env.GOOGLE_MAPS_API_KEY) {
    // 临时诊断:env 缺 key · 必删 next iteration
    logger.error('geocode.no_key', { lat: lat.toFixed(2), lng: lng.toFixed(2) });
    return null;
  }
  // 临时诊断:key 存在,真调 Google · 必删
  logger.info('geocode.calling', { lat: lat.toFixed(2), lng: lng.toFixed(2), key_prefix: env.GOOGLE_MAPS_API_KEY.slice(0, 6) });

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
    // 不限制 result_type(海面/边远坐标 Google 可能找不到 sublocality/locality 类型)
    // 解析时从 address_components 用宽 fallback 链取
    url.searchParams.set('language', 'en');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      logger.error('geocode.http_failed', { status: res.status, lat, lng });
      return null;
    }
    const data = (await res.json()) as {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry?: { location: { lat: number; lng: number } };
        address_components: Array<{
          long_name: string;
          short_name: string;
          types: string[];
        }>;
      }>;
      error_message?: string;
    };

    if (data.status !== 'OK' || !data.results.length) {
      if (data.status !== 'ZERO_RESULTS') {
        logger.error('geocode.status_not_ok', { status: data.status, msg: data.error_message });
      }
      return null;
    }

    const r = data.results[0]!;
    const comps = r.address_components;
    const findByType = (type: string): string | null => {
      const c = comps.find((c) => c.types.includes(type));
      return c?.long_name ?? null;
    };
    const findShortByType = (type: string): string | null => {
      const c = comps.find((c) => c.types.includes(type));
      return c?.short_name ?? null;
    };

    // city 宽 fallback 链:locality → administrative_area_level_2 → admin_level_1
    // area 宽 fallback 链:sublocality(*)→ neighborhood → administrative_area_level_3
    // 临时诊断 log:把命中的字段打出来 · 失败后改回去
    const city =
      findByType('locality') ??
      findByType('administrative_area_level_2') ??
      findByType('administrative_area_level_1');
    const area =
      findByType('sublocality') ??
      findByType('sublocality_level_1') ??
      findByType('sublocality_level_2') ??
      findByType('neighborhood') ??
      findByType('administrative_area_level_3');
    logger.info('geocode.parsed', {
      status: data.status,
      results_count: data.results.length,
      city,
      area,
      components_types: comps.map((c) => c.types.join('+')).slice(0, 8).join(','),
    });

    return {
      formatted: r.formatted_address,
      countryCode: findShortByType('country'), // ISO alpha-2
      city,
      area,
      lat: r.geometry?.location.lat ?? lat,
      lng: r.geometry?.location.lng ?? lng,
    };
  } catch (e) {
    logger.error('geocode.throw', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
