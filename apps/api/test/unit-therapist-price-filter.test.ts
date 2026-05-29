/**
 * 单元测试 · /therapists?price_max=N 过滤行为(纯函数版)
 *
 * 目标:对齐 services/therapists.ts 中 priceMax 的 SQL 行为
 * 规则:basePriceJson 数组 [{duration, pricePoints}] · ANY 一档 ≤ priceMax 即命中
 *
 * 实现:把过滤逻辑提为纯函数测 · 不调 db
 */

import { describe, it, expect } from 'vitest';

interface PriceItem {
  duration: number;
  pricePoints: number;
}

interface TherapistLike {
  id: string;
  basePriceJson: PriceItem[] | null;
}

/** 纯函数版 priceMax 过滤(对齐 SQL EXISTS jsonb_array_elements ≤ priceMax) */
function filterByPriceMax(list: TherapistLike[], priceMax: number | undefined): TherapistLike[] {
  if (typeof priceMax !== 'number') return list;
  return list.filter((t) => {
    if (!t.basePriceJson || t.basePriceJson.length === 0) return false; // 无价 = 排除
    return t.basePriceJson.some((p) => p.pricePoints <= priceMax);
  });
}

function t(id: string, prices: number[] | null): TherapistLike {
  return {
    id,
    basePriceJson: prices === null ? null : prices.map((p, i) => ({ duration: 60 + i * 60, pricePoints: p })),
  };
}

describe('Unit · priceMax · undefined 不过滤', () => {
  it('undefined 时返回全量', () => {
    const list = [t('a', [500]), t('b', [3000]), t('c', null)];
    expect(filterByPriceMax(list, undefined)).toHaveLength(3);
  });
});

describe('Unit · priceMax · 单档价', () => {
  it('唯一档 < priceMax · 命中', () => {
    const list = [t('a', [500])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(1);
  });

  it('唯一档 = priceMax · 命中(≤ 含等)', () => {
    const list = [t('a', [1000])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(1);
  });

  it('唯一档 > priceMax · 不命中', () => {
    const list = [t('a', [1500])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(0);
  });
});

describe('Unit · priceMax · 多档价(关键行为)', () => {
  it('多档中 ANY 一档 ≤ priceMax · 命中', () => {
    // 60min 900 · 120min 2500 · 用户预算 1000 → 900 命中 → 该技师入选
    const list = [t('a', [900, 2500])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(1);
  });

  it('多档全部 > priceMax · 不命中', () => {
    const list = [t('a', [1500, 2500, 4000])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(0);
  });

  it('多档 · 最便宜的档刚好 = priceMax · 命中', () => {
    const list = [t('a', [1000, 2000, 3000])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(1);
  });
});

describe('Unit · priceMax · 边界', () => {
  it('null basePriceJson · 当作不可下单 · 不命中', () => {
    const list = [t('a', null)];
    expect(filterByPriceMax(list, 1000)).toHaveLength(0);
  });

  it('空数组 basePriceJson · 不命中', () => {
    const list = [t('a', [])];
    expect(filterByPriceMax(list, 1000)).toHaveLength(0);
  });

  it('priceMax=0 · 所有正价不命中', () => {
    const list = [t('a', [100]), t('b', [500])];
    expect(filterByPriceMax(list, 0)).toHaveLength(0);
  });

  it('priceMax=Infinity 等价高值 · 全命中', () => {
    const list = [t('a', [1000000])];
    expect(filterByPriceMax(list, 1e9)).toHaveLength(1);
  });
});

describe('Unit · priceMax · 综合排序场景', () => {
  it('混合 5 个技师 · priceMax=1000 只保留最便宜档 ≤ 1000 的', () => {
    const list = [
      t('cheap-only', [600]),                    // ✓ 单档便宜
      t('cheap-and-expensive', [800, 3000]),     // ✓ 有便宜档
      t('all-expensive', [2000, 5000]),          // ✗ 全贵
      t('boundary', [1000]),                     // ✓ 边界
      t('no-price', null),                        // ✗ 无价
    ];
    const out = filterByPriceMax(list, 1000);
    expect(out.map((x) => x.id)).toEqual(['cheap-only', 'cheap-and-expensive', 'boundary']);
  });
});
