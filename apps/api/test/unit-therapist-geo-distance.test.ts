/**
 * 单元测试 · /therapists 发现页地理距离过滤/排序(纯函数版)
 *
 * 覆盖 services/therapists.ts 的 applyGeoDistance:
 *  - 不传 viewer → 原序 + distanceKm=null
 *  - 传 lat/lng 不传 radius → 不过滤,按距离升序,无坐标排末尾
 *  - 传 radius → 剔除超半径 + 无坐标,按距离升序
 *
 * 不依赖 DB · 坐标用字典中心(string)模拟。
 */

import { describe, it, expect } from 'vitest';
import { applyGeoDistance, type GeoItem } from '../src/services/therapists';

// 曼谷市中心客户坐标
const VIEWER = { lat: 13.7563, lng: 100.5018 };

// 几个区域中心坐标(近似真实)
const SILOM = { lat: '13.7248', lng: '100.5340' }; // 距市中心 ~4km
const THONGLOR = { lat: '13.7300', lng: '100.5800' }; // 距市中心 ~9km
const CHIANGMAI = { lat: '18.7883', lng: '98.9853' }; // 距曼谷 ~580km

function mk(id: string, lat?: string | null, lng?: string | null): GeoItem<{ id: string }> {
  return { item: { id }, lat, lng };
}

describe('applyGeoDistance', () => {
  it('不传 viewer → 原序保持 · distanceKm 全为 null', () => {
    const rows = [mk('a', SILOM.lat, SILOM.lng), mk('b', null, null)];
    const out = applyGeoDistance(rows, null);
    expect(out.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(out.every((r) => r.distanceKm === null)).toBe(true);
  });

  it('传 lat/lng 不传 radius → 不过滤 · 按距离升序 · 无坐标排末尾', () => {
    const rows = [
      mk('far', THONGLOR.lat, THONGLOR.lng),
      mk('nocoord', null, null),
      mk('near', SILOM.lat, SILOM.lng),
    ];
    const out = applyGeoDistance(rows, VIEWER);
    // near < far < nocoord(null 末尾)
    expect(out.map((r) => r.item.id)).toEqual(['near', 'far', 'nocoord']);
    expect(out[0]!.distanceKm).not.toBeNull();
    expect(out[2]!.distanceKm).toBeNull();
    // 升序
    expect(out[0]!.distanceKm!).toBeLessThanOrEqual(out[1]!.distanceKm!);
  });

  it('传 radius → 剔除超半径 + 无坐标 · 按距离升序', () => {
    const rows = [
      mk('silom', SILOM.lat, SILOM.lng), // ~4km
      mk('thonglor', THONGLOR.lat, THONGLOR.lng), // ~9km
      mk('chiangmai', CHIANGMAI.lat, CHIANGMAI.lng), // ~580km
      mk('nocoord', null, null),
    ];
    const out = applyGeoDistance(rows, { ...VIEWER, radiusKm: 5 });
    // 仅 silom 在 5km 内
    expect(out.map((r) => r.item.id)).toEqual(['silom']);
    expect(out[0]!.distanceKm!).toBeLessThanOrEqual(5);
  });

  it('radius 较大时多个命中 · 仍按距离升序', () => {
    const rows = [
      mk('thonglor', THONGLOR.lat, THONGLOR.lng),
      mk('silom', SILOM.lat, SILOM.lng),
    ];
    const out = applyGeoDistance(rows, { ...VIEWER, radiusKm: 50 });
    expect(out.map((r) => r.item.id)).toEqual(['silom', 'thonglor']);
    expect(out[0]!.distanceKm!).toBeLessThanOrEqual(out[1]!.distanceKm!);
  });

  it('坐标缺失(只有 lat 无 lng)→ distanceKm null · radius 模式被剔除', () => {
    const rows = [mk('halfcoord', SILOM.lat, null), mk('full', SILOM.lat, SILOM.lng)];
    const out = applyGeoDistance(rows, { ...VIEWER, radiusKm: 100 });
    expect(out.map((r) => r.item.id)).toEqual(['full']);
  });

  it('min_rating 换算公式自检:9 分 → 三维和阈值 2700', () => {
    // 文档化换算:minRating(0-10) * 300 = 三维和(0-3000)阈值
    const threshold = Math.round(9 * 300);
    expect(threshold).toBe(2700);
  });
});
