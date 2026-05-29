/**
 * 单元测试 · classifySupplyDemand 纯函数(供需缺口阈值)
 *
 * 5 个 status:
 *   critical_shortage(比 >3 红)
 *   shortage(1.5-3 黄)
 *   balanced(0.5-1.5 绿)
 *   oversupply(<0.5 蓝)
 *   unopened(技师=0 灰 · 不计比值)
 */

import { describe, it, expect } from 'vitest';
import { classifySupplyDemand } from '../src/services/geo-insights';

describe('Unit · classifySupplyDemand · 阈值', () => {
  it('技师=0 · 客户=0 → unopened · 建议撤城', () => {
    const r = classifySupplyDemand({ therapistCount: 0, customerCount: 0 });
    expect(r.status).toBe('unopened');
    expect(r.ratio).toBeNull();
    expect(r.suggestion).toContain('暂未开通');
  });

  it('技师=0 · 客户>0 → unopened · 建议拉技师', () => {
    const r = classifySupplyDemand({ therapistCount: 0, customerCount: 8 });
    expect(r.status).toBe('unopened');
    expect(r.suggestion).toContain('立即拉技师');
  });

  it('比 = 5(>3)→ critical_shortage', () => {
    const r = classifySupplyDemand({ therapistCount: 2, customerCount: 10 });
    expect(r.status).toBe('critical_shortage');
    expect(r.ratio).toBe(5);
  });

  it('比 = 2(1.5-3)→ shortage', () => {
    const r = classifySupplyDemand({ therapistCount: 5, customerCount: 10 });
    expect(r.status).toBe('shortage');
    expect(r.ratio).toBe(2);
  });

  it('比 = 1(0.5-1.5)→ balanced', () => {
    const r = classifySupplyDemand({ therapistCount: 10, customerCount: 10 });
    expect(r.status).toBe('balanced');
    expect(r.ratio).toBe(1);
  });

  it('比 = 0.5(边界 · 0.5-1.5)→ balanced', () => {
    const r = classifySupplyDemand({ therapistCount: 10, customerCount: 5 });
    expect(r.status).toBe('balanced');
    expect(r.ratio).toBe(0.5);
  });

  it('比 = 0.3(<0.5)→ oversupply', () => {
    const r = classifySupplyDemand({ therapistCount: 10, customerCount: 3 });
    expect(r.status).toBe('oversupply');
    expect(r.ratio).toBe(0.3);
  });

  it('比 = 0(<0.5)→ oversupply', () => {
    const r = classifySupplyDemand({ therapistCount: 10, customerCount: 0 });
    expect(r.status).toBe('oversupply');
    expect(r.ratio).toBe(0);
  });

  it('边界 · 比 = 3 → shortage(非 critical · 严格 >)', () => {
    const r = classifySupplyDemand({ therapistCount: 1, customerCount: 3 });
    expect(r.status).toBe('shortage');
  });

  it('边界 · 比 = 1.5(上限 · 仍 balanced)', () => {
    const r = classifySupplyDemand({ therapistCount: 2, customerCount: 3 });
    expect(r.status).toBe('balanced');
  });

  it('边界 · 比 = 1.51 → shortage(刚超 1.5)', () => {
    const r = classifySupplyDemand({ therapistCount: 100, customerCount: 151 });
    expect(r.status).toBe('shortage');
  });
});
