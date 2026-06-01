/**
 * 地理距离计算 · Haversine 公式
 *
 * - 仅服务端用 · 不暴露客户原始坐标给技师
 * - 输入坐标 string(从 DB text 字段读) · 自动 parseFloat 失败容错
 * - 返回 km(整数四舍五入 · 1km 起步)
 *
 * 隐私:
 *   - 距离对客户可见(模糊到 1km)
 *   - 技师永远拿不到客户 GPS 原始坐标(即使距离也只在客户视角算)
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine 算两点球面距离 · 返 km
 * null 表示无法计算(任一参数缺失/非数字)
 */
export function distanceKm(
  lat1: number | string | null | undefined,
  lng1: number | string | null | undefined,
  lat2: number | string | null | undefined,
  lng2: number | string | null | undefined,
): number | null {
  const a1 = typeof lat1 === 'string' ? parseFloat(lat1) : lat1;
  const o1 = typeof lng1 === 'string' ? parseFloat(lng1) : lng1;
  const a2 = typeof lat2 === 'string' ? parseFloat(lat2) : lat2;
  const o2 = typeof lng2 === 'string' ? parseFloat(lng2) : lng2;
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;
  if (!Number.isFinite(a1) || !Number.isFinite(o1) || !Number.isFinite(a2) || !Number.isFinite(o2)) return null;

  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const lat1Rad = toRad(a1);
  const lat2Rad = toRad(a2);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** 四舍五入到 km · 0.5km 显示成 '1km 内' · 用于客户端展示 */
export function distanceKmRounded(
  lat1: number | string | null | undefined,
  lng1: number | string | null | undefined,
  lat2: number | string | null | undefined,
  lng2: number | string | null | undefined,
): number | null {
  const d = distanceKm(lat1, lng1, lat2, lng2);
  if (d == null) return null;
  if (d < 1) return 1;
  return Math.round(d);
}
