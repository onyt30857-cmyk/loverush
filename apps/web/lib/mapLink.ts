/**
 * 地图导航深链 · 到店服务「找店指引」用
 *
 * 用户点门店地址 → 唤起手机地图按地址文本搜索。
 * 不依赖经纬度(技师只填了文本地址),用通用的「地址查询」深链:
 *   - iOS Safari/微信内:Apple Maps / 高德 / 微信内置地图能识别 https://maps.google.com/?q=...
 *   - Android:Google Maps 同样识别 ?q= 文本查询
 *   - 国内环境(无 Google):geo: scheme 由系统选地图 app(高德/百度)接管
 *
 * 策略:返回一个通用 https Google Maps query URL(最广兼容、桌面也能开),
 * 同时导出 geoUri 给「在地图中打开」二选一场景。绝不假装有坐标。
 */

/** 通用地图查询链接(https · 桌面/移动皆可开) */
export function mapSearchUrl(address: string): string {
  const q = encodeURIComponent(address.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** geo: scheme · 移动端由系统选择地图 app(高德/百度/Apple 地图)接管 */
export function mapGeoUri(address: string): string {
  const q = encodeURIComponent(address.trim());
  // geo:0,0?q=地址 是 Android/部分系统识别的「按文本搜索」格式
  return `geo:0,0?q=${q}`;
}

/**
 * 打开地址导航 · 优先 https(兼容最广,微信/桌面都能开),
 * 在新标签打开避免顶掉当前应用上下文。
 */
export function openMapNavigation(address: string): void {
  if (!address || !address.trim()) return;
  if (typeof window === 'undefined') return;
  window.open(mapSearchUrl(address), '_blank', 'noopener,noreferrer');
}

/**
 * 坐标导航链接(https · 上门服务客户有精确经纬度时优先用)
 * Google Maps 路线规划深链 · destination=lat,lng 最精确,桌面/移动皆可开。
 */
export function mapDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * 上门导航 · 有经纬度优先按坐标规划路线(最精确),否则退回地址文本搜索。
 * 绝不假装有坐标:lat/lng 非有限数时一律走文本兜底。
 */
export function openMapToCoords(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
  address?: string | null,
): void {
  if (typeof window === 'undefined') return;
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (Number.isFinite(la) && Number.isFinite(ln)) {
    window.open(mapDirectionsUrl(la, ln), '_blank', 'noopener,noreferrer');
    return;
  }
  if (address && address.trim()) {
    window.open(mapSearchUrl(address), '_blank', 'noopener,noreferrer');
  }
}
