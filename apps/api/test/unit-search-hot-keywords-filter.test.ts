/**
 * 单元测试 · 热门词 locale/city/时段过滤逻辑(纯函数)
 *
 * 测试目标:模拟 routes/search.ts `/hot-keywords` 的过滤行为
 * - locale 命中(targetLocales=null 通配 + 数组命中)
 * - city 命中(同上)
 * - 时段命中(startsAt/endsAt nullable + 时间区间)
 *
 * 实现:把过滤逻辑提为纯函数测 · 不调 db
 */

import { describe, it, expect } from 'vitest';

interface KeywordLike {
  keyword: string;
  enabled: number;
  targetLocales: string[] | null;
  targetCities: string[] | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** 纯函数版过滤(对齐 routes/search.ts 的 SQL where 行为) */
function filterKeywords(
  list: KeywordLike[],
  ctx: { locale?: string; city?: string; now?: Date },
): KeywordLike[] {
  const now = ctx.now ?? new Date();
  return list.filter((k) => {
    if (k.enabled !== 1) return false;
    if (k.startsAt && k.startsAt > now) return false;
    if (k.endsAt && k.endsAt < now) return false;
    if (k.targetLocales !== null) {
      if (!ctx.locale) return false;
      if (!k.targetLocales.includes(ctx.locale)) return false;
    }
    if (k.targetCities !== null) {
      if (!ctx.city) return false;
      if (!k.targetCities.includes(ctx.city)) return false;
    }
    return true;
  });
}

function k(overrides: Partial<KeywordLike> & { keyword: string }): KeywordLike {
  return {
    enabled: 1,
    targetLocales: null,
    targetCities: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

describe('Unit · hot-keywords 过滤 · enabled', () => {
  it('enabled=0 直接过滤', () => {
    const out = filterKeywords([k({ keyword: 'a', enabled: 0 })], {});
    expect(out).toHaveLength(0);
  });
});

describe('Unit · hot-keywords 过滤 · locale', () => {
  it('targetLocales=null · 不传 locale · 命中', () => {
    const out = filterKeywords([k({ keyword: 'a' })], {});
    expect(out).toHaveLength(1);
  });

  it('targetLocales=null · 传 locale · 也命中(null=全投放)', () => {
    const out = filterKeywords([k({ keyword: 'a' })], { locale: 'zh-CN' });
    expect(out).toHaveLength(1);
  });

  it('targetLocales=["zh-CN"] · 不传 locale · 不命中', () => {
    const out = filterKeywords([k({ keyword: 'a', targetLocales: ['zh-CN'] })], {});
    expect(out).toHaveLength(0);
  });

  it('targetLocales=["zh-CN"] · 传 zh-CN · 命中', () => {
    const out = filterKeywords([k({ keyword: 'a', targetLocales: ['zh-CN'] })], { locale: 'zh-CN' });
    expect(out).toHaveLength(1);
  });

  it('targetLocales=["zh-CN","th"] · 传 th · 命中', () => {
    const out = filterKeywords([k({ keyword: 'a', targetLocales: ['zh-CN', 'th'] })], {
      locale: 'th',
    });
    expect(out).toHaveLength(1);
  });

  it('targetLocales=["zh-CN"] · 传 en · 不命中', () => {
    const out = filterKeywords([k({ keyword: 'a', targetLocales: ['zh-CN'] })], { locale: 'en' });
    expect(out).toHaveLength(0);
  });
});

describe('Unit · hot-keywords 过滤 · city', () => {
  it('targetCities=null + 无 city · 命中', () => {
    const out = filterKeywords([k({ keyword: 'a' })], {});
    expect(out).toHaveLength(1);
  });

  it('targetCities=["曼谷"] + city=曼谷 · 命中', () => {
    const out = filterKeywords([k({ keyword: 'a', targetCities: ['曼谷'] })], { city: '曼谷' });
    expect(out).toHaveLength(1);
  });

  it('targetCities=["曼谷"] + city=清迈 · 不命中', () => {
    const out = filterKeywords([k({ keyword: 'a', targetCities: ['曼谷'] })], { city: '清迈' });
    expect(out).toHaveLength(0);
  });
});

describe('Unit · hot-keywords 过滤 · 时段', () => {
  const NOW = new Date('2026-06-01T12:00:00Z');

  it('无时段限制 · 永久投放', () => {
    const out = filterKeywords([k({ keyword: 'a' })], { now: NOW });
    expect(out).toHaveLength(1);
  });

  it('startsAt 在未来 · 未到点 · 不命中', () => {
    const out = filterKeywords(
      [k({ keyword: 'a', startsAt: new Date('2026-06-02T00:00:00Z') })],
      { now: NOW },
    );
    expect(out).toHaveLength(0);
  });

  it('startsAt 在过去 · 已上线 · 命中', () => {
    const out = filterKeywords(
      [k({ keyword: 'a', startsAt: new Date('2026-05-01T00:00:00Z') })],
      { now: NOW },
    );
    expect(out).toHaveLength(1);
  });

  it('endsAt 在过去 · 已下线 · 不命中', () => {
    const out = filterKeywords(
      [k({ keyword: 'a', endsAt: new Date('2026-05-01T00:00:00Z') })],
      { now: NOW },
    );
    expect(out).toHaveLength(0);
  });

  it('endsAt 在未来 · 还在档期 · 命中', () => {
    const out = filterKeywords(
      [k({ keyword: 'a', endsAt: new Date('2026-12-31T00:00:00Z') })],
      { now: NOW },
    );
    expect(out).toHaveLength(1);
  });

  it('节日热词:startsAt+endsAt 都在档 · 命中', () => {
    const out = filterKeywords(
      [
        k({
          keyword: 'spring-festival',
          startsAt: new Date('2026-01-25T00:00:00Z'),
          endsAt: new Date('2026-02-15T00:00:00Z'),
        }),
      ],
      { now: new Date('2026-02-01T00:00:00Z') },
    );
    expect(out).toHaveLength(1);
  });
});

describe('Unit · hot-keywords 过滤 · 综合', () => {
  it('混合多种条件 · 只保留全部命中的', () => {
    const NOW = new Date('2026-06-01T12:00:00Z');
    const list = [
      k({ keyword: 'global-always' }),                                    // 全通配 · 命中
      k({ keyword: 'zh-only', targetLocales: ['zh-CN'] }),                // 仅 zh-CN · 当前 zh-CN · 命中
      k({ keyword: 'th-only', targetLocales: ['th'] }),                   // 仅 th · 当前 zh-CN · 不命中
      k({ keyword: 'bangkok-only', targetCities: ['曼谷'] }),              // 仅曼谷 · 当前曼谷 · 命中
      k({ keyword: 'disabled', enabled: 0 }),                             // 关 · 不命中
      k({
        keyword: 'future',
        startsAt: new Date('2027-01-01T00:00:00Z'),
      }),                                                                  // 未来 · 不命中
    ];
    const out = filterKeywords(list, { locale: 'zh-CN', city: '曼谷', now: NOW });
    expect(out.map((x) => x.keyword)).toEqual(['global-always', 'zh-only', 'bangkok-only']);
  });
});
