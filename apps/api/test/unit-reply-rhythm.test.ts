/**
 * unit · 回复节奏与多样性 P0(无 DB,纯函数)
 *  - coalesceSegments:连发条数对齐真人分布(ACMC≈1.7),概率合并 + 合并正确性
 *  - generateTease:repeat-distance 防复读,避开最近发过的撩拨句
 */
import { describe, it, expect } from 'vitest';
import { coalesceSegments } from '../src/services/ai_alter';
import { generateTease } from '../src/services/companionMedia';

describe('coalesceSegments · 连发条数对齐真人分布', () => {
  it('单段/空不动', () => {
    expect(coalesceSegments([])).toEqual([]);
    expect(coalesceSegments(['只有一句'])).toEqual(['只有一句']);
  });

  it('rand<0.6 → 合并成 1 条', () => {
    expect(coalesceSegments(['a', 'b', 'c'], () => 0.5)).toEqual(['a b c']);
  });

  it('0.6≤rand<0.9 → 合并成 2 条(相邻均匀并组)', () => {
    expect(coalesceSegments(['a', 'b', 'c'], () => 0.7)).toEqual(['a b', 'c']);
    expect(coalesceSegments(['a', 'b', 'c', 'd'], () => 0.7)).toEqual(['a b', 'c d']);
  });

  it('rand≥0.9 → 目标 3 条,原 3 段不变', () => {
    expect(coalesceSegments(['a', 'b', 'c'], () => 0.95)).toEqual(['a', 'b', 'c']);
  });

  it('目标条数 ≥ 现有段数时不动(2 段、目标 3)', () => {
    expect(coalesceSegments(['a', 'b'], () => 0.95)).toEqual(['a', 'b']);
  });

  it('分布近似 ACMC≈1.7:大样本平均连发条数落在 1.4-1.8', () => {
    // 固定一个伪随机序列,统计 3 段输入被合并后的平均条数
    let seed = 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    let totalSegs = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) totalSegs += coalesceSegments(['a', 'b', 'c'], rand).length;
    const acmc = totalSegs / N;
    expect(acmc).toBeGreaterThan(1.4);
    expect(acmc).toBeLessThan(1.8);
  });
});

describe('generateTease · repeat-distance 防复读', () => {
  it('不传 recentTexts → 返回库中某条', () => {
    const t = generateTease();
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(0);
  });

  it('避开最近发过的:库剩一条时必返回那一条', () => {
    // 先拿全库:连续多次收集去重得到全集
    const all = new Set<string>();
    for (let i = 0; i < 200; i++) all.add(generateTease());
    const full = [...all];
    expect(full.length).toBeGreaterThanOrEqual(10); // 库已扩到 15
    const exceptLast = full.slice(0, full.length - 1);
    const remaining = full[full.length - 1]!;
    // recentTexts = 除最后一条外全部 → 只能返回最后那条
    for (let i = 0; i < 20; i++) {
      expect(generateTease(exceptLast)).toBe(remaining);
    }
  });

  it('全库都在 recentTexts(极端)→ 回退全库不报错', () => {
    const all = new Set<string>();
    for (let i = 0; i < 200; i++) all.add(generateTease());
    const t = generateTease([...all]);
    expect(all.has(t)).toBe(true);
  });
});
