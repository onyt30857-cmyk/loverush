/**
 * 单元测试 · 到店服务门店信息门控(纯函数,不依赖 PG)
 *
 * 重点验证 shopInfoVisible:
 * - LOCKED+ 状态 且 技师 incall/both → 可见
 * - 门控前状态(DRAFT/PENDING_CONFIRM)→ 不可见(绝不在门控外下发地址)
 * - 取消/争议态 → 不可见
 * - outcall 技师 → 永不可见
 * - 缺失入参 → 不可见(安全默认)
 */

import { describe, it, expect } from 'vitest';
import { shopInfoVisible } from '../src/services/shopInfo';

describe('shopInfoVisible 门控', () => {
  const visibleStatuses = ['LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED'];
  const hiddenStatuses = ['DRAFT', 'PENDING_CONFIRM', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'CLOSED'];

  it('门控内状态 + incall → 可见', () => {
    for (const s of visibleStatuses) {
      expect(shopInfoVisible(s, 'incall')).toBe(true);
    }
  });

  it('门控内状态 + both → 可见', () => {
    for (const s of visibleStatuses) {
      expect(shopInfoVisible(s, 'both')).toBe(true);
    }
  });

  it('门控前/取消/争议态 → 不可见(绝不下发)', () => {
    for (const s of hiddenStatuses) {
      expect(shopInfoVisible(s, 'incall')).toBe(false);
      expect(shopInfoVisible(s, 'both')).toBe(false);
    }
  });

  it('outcall 技师 → 任何状态都不可见', () => {
    for (const s of [...visibleStatuses, ...hiddenStatuses]) {
      expect(shopInfoVisible(s, 'outcall')).toBe(false);
    }
  });

  it('缺失入参 → 不可见(安全默认)', () => {
    expect(shopInfoVisible(undefined, 'incall')).toBe(false);
    expect(shopInfoVisible('LOCKED', undefined)).toBe(false);
    expect(shopInfoVisible(null, null)).toBe(false);
  });
});
