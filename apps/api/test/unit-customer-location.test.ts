/**
 * 单元测试 · 上门服务客户地址门控(纯函数,不依赖 PG)
 *
 * 重点验证 customerLocationVisibleToTherapist(技师视角是否看到【完整】门牌):
 * - LOCKED+ 状态 且 技师 outcall/both → 可见(确认/锁单后才下发门牌)
 * - 门控前状态(DRAFT/PENDING_CONFIRM)→ 不可见(确认前只区域+距离,绝不漏门牌)
 * - 取消/争议态 → 不可见
 * - incall 技师 → 永不可见(到店不需要客户地址)
 * - 缺失入参 → 不可见(安全默认)
 */

import { describe, it, expect } from 'vitest';
import { customerLocationVisibleToTherapist } from '../src/services/customerLocation';

describe('customerLocationVisibleToTherapist 门控', () => {
  const visibleStatuses = ['LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED'];
  const hiddenStatuses = ['DRAFT', 'PENDING_CONFIRM', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'CLOSED'];

  it('门控内状态 + outcall → 技师可见完整门牌', () => {
    for (const s of visibleStatuses) {
      expect(customerLocationVisibleToTherapist(s, 'outcall')).toBe(true);
    }
  });

  it('门控内状态 + both → 技师可见完整门牌', () => {
    for (const s of visibleStatuses) {
      expect(customerLocationVisibleToTherapist(s, 'both')).toBe(true);
    }
  });

  it('门控前/取消/争议态 → 技师不可见完整门牌(确认前只区域+距离)', () => {
    for (const s of hiddenStatuses) {
      expect(customerLocationVisibleToTherapist(s, 'outcall')).toBe(false);
      expect(customerLocationVisibleToTherapist(s, 'both')).toBe(false);
    }
  });

  it('incall 技师 → 任何状态都不可见(到店不需要客户地址)', () => {
    for (const s of [...visibleStatuses, ...hiddenStatuses]) {
      expect(customerLocationVisibleToTherapist(s, 'incall')).toBe(false);
    }
  });

  it('缺失入参 → 不可见(安全默认)', () => {
    expect(customerLocationVisibleToTherapist(undefined, 'outcall')).toBe(false);
    expect(customerLocationVisibleToTherapist('LOCKED', undefined)).toBe(false);
    expect(customerLocationVisibleToTherapist(null, null)).toBe(false);
  });
});
