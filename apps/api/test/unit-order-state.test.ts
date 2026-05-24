/**
 * 单元测试 · 订单状态机（纯函数，不依赖 PG）
 *
 * 重点验证：
 * - 11 状态全部声明
 * - 合法转移按 PRD 流程
 * - 终态（CLOSED）不可再转出
 * - 退款只能从 DISPUTED 进入（防止误退）
 * - 不存在的状态对 → false
 */

import { describe, it, expect } from 'vitest';
import { ORDER_TRANSITIONS, canTransition } from '../src/services/orders';

const ALL_STATUSES = [
  'DRAFT',
  'PENDING_CONFIRM',
  'LOCKED',
  'PAID',
  'IN_SERVICE',
  'COMPLETED',
  'REVIEWED',
  'CANCELLED',
  'DISPUTED',
  'REFUNDED',
  'CLOSED',
] as const;

describe('order state machine · ORDER_TRANSITIONS 完整性', () => {
  it('应当声明全部 11 个状态', () => {
    for (const s of ALL_STATUSES) {
      expect(ORDER_TRANSITIONS).toHaveProperty(s);
      expect(Array.isArray(ORDER_TRANSITIONS[s])).toBe(true);
    }
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('所有目标状态必须是合法状态（无悬空引用）', () => {
    const known = new Set(ALL_STATUSES);
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of tos) {
        expect(known.has(to), `${from} -> ${to} 中 ${to} 未在状态枚举里`).toBe(true);
      }
    }
  });

  it('不应有自循环（X -> X）', () => {
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) {
      expect(tos, `状态 ${from} 不允许自循环`).not.toContain(from);
    }
  });
});

describe('order state machine · 关键业务路径', () => {
  it('黄金路径：DRAFT → PENDING_CONFIRM → LOCKED → PAID → IN_SERVICE → COMPLETED → REVIEWED → CLOSED', () => {
    const path = [
      'DRAFT',
      'PENDING_CONFIRM',
      'LOCKED',
      'PAID',
      'IN_SERVICE',
      'COMPLETED',
      'REVIEWED',
      'CLOSED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('已支付才能开始服务（PAID → IN_SERVICE）', () => {
    expect(canTransition('PAID', 'IN_SERVICE')).toBe(true);
    expect(canTransition('LOCKED', 'IN_SERVICE')).toBe(false);
    expect(canTransition('DRAFT', 'IN_SERVICE')).toBe(false);
  });

  it('退款只能从 DISPUTED 进入（任何其他状态 -> REFUNDED 必须先经过申诉）', () => {
    for (const s of ALL_STATUSES) {
      if (s === 'DISPUTED') {
        expect(canTransition(s, 'REFUNDED')).toBe(true);
      } else {
        expect(canTransition(s, 'REFUNDED'), `${s} 不应直接退款`).toBe(false);
      }
    }
  });

  it('终态 CLOSED 不可再转出（任何 to 都 false）', () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition('CLOSED', s)).toBe(false);
    }
  });

  it('REFUNDED / CANCELLED 仅能流向 CLOSED', () => {
    for (const s of ALL_STATUSES) {
      const expected = s === 'CLOSED';
      expect(canTransition('REFUNDED', s)).toBe(expected);
      expect(canTransition('CANCELLED', s)).toBe(expected);
    }
  });

  it('DISPUTED 可三向：REFUNDED / COMPLETED / CLOSED', () => {
    expect(canTransition('DISPUTED', 'REFUNDED')).toBe(true);
    expect(canTransition('DISPUTED', 'COMPLETED')).toBe(true);
    expect(canTransition('DISPUTED', 'CLOSED')).toBe(true);
    expect(canTransition('DISPUTED', 'PAID')).toBe(false);
  });

  it('PAID 后仍可申诉（黑后台路径）', () => {
    expect(canTransition('PAID', 'DISPUTED')).toBe(true);
    expect(canTransition('IN_SERVICE', 'DISPUTED')).toBe(true);
    expect(canTransition('COMPLETED', 'DISPUTED')).toBe(true);
    expect(canTransition('REVIEWED', 'DISPUTED')).toBe(true);
  });

  it('REVIEWED 后不能取消（已评价 → 只能 DISPUTED 或 CLOSED）', () => {
    expect(canTransition('REVIEWED', 'CANCELLED')).toBe(false);
    expect(canTransition('REVIEWED', 'PAID')).toBe(false);
  });

  it('未支付状态可被取消（DRAFT/PENDING_CONFIRM/LOCKED -> CANCELLED）', () => {
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransition('PENDING_CONFIRM', 'CANCELLED')).toBe(true);
    expect(canTransition('LOCKED', 'CANCELLED')).toBe(true);
  });

  it('IN_SERVICE 后不能直接取消（防扯皮，必须走 DISPUTED）', () => {
    expect(canTransition('IN_SERVICE', 'CANCELLED')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });
});

describe('order state machine · canTransition 边界', () => {
  it('不存在的源状态返回 undefined.includes → 抛 TypeError 或 false（取决于 TS）', () => {
    // ts-expect-error: 故意传非法状态测健壮性
    expect(() => canTransition('FOO' as any, 'CLOSED')).toThrow();
  });
});
