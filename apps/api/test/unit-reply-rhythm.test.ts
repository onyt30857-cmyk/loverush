/**
 * unit · 回复节奏与多样性 P0(无 DB,纯函数)
 *  - coalesceSegments:连发条数对齐真人分布(ACMC≈1.7),概率合并 + 合并正确性
 *  - generateTease:repeat-distance 防复读,避开最近发过的撩拨句
 */
import { describe, it, expect } from 'vitest';
import { coalesceSegments, pickExpressionMood, looksUnfinished } from '../src/services/ai_alter';
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

describe('pickExpressionMood · 今日小心情(P1-b)', () => {
  const day = new Date('2026-06-07T03:00:00Z');
  it('同会话同一天稳定(可重复)', () => {
    const a = pickExpressionMood('conv-1', day);
    const b = pickExpressionMood('conv-1', day);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
  it('隔天会变(大概率不同)', () => {
    const d1 = new Date('2026-06-07T03:00:00Z');
    const d2 = new Date('2026-06-08T03:00:00Z');
    // 不强求一定不同(5 选 1 有撞概率),但多个会话跨两天的组合应出现多样
    const set = new Set<string>();
    for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) {
      set.add(pickExpressionMood(c, d1));
      set.add(pickExpressionMood(c, d2));
    }
    expect(set.size).toBeGreaterThan(1);
  });
});

describe('looksUnfinished · 语义防抢话(P2-a)', () => {
  it('逗号/顿号/省略号收尾 → 没说完', () => {
    expect(looksUnfinished('我想说，')).toBe(true);
    expect(looksUnfinished('有这个、那个、')).toBe(true);
    expect(looksUnfinished('等我想想…')).toBe(true);
  });
  it('连接词结尾 → 没说完', () => {
    expect(looksUnfinished('我去了但是')).toBe(true);
    expect(looksUnfinished('等一下')).toBe(true);
    expect(looksUnfinished('还有')).toBe(true);
  });
  it('正常句/问句/空 → 说完了(不误判)', () => {
    expect(looksUnfinished('今晚有空吗？')).toBe(false);
    expect(looksUnfinished('好的')).toBe(false);
    expect(looksUnfinished('在吗')).toBe(false);
    expect(looksUnfinished('')).toBe(false);
    expect(looksUnfinished(undefined)).toBe(false);
  });
});
