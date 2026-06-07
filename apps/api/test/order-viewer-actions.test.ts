import { describe, it, expect } from 'vitest';
import { computeViewerActions } from '../src/services/orders';
import type { Order } from '@loverush/db';

const T = 'therapist-user';
const C = 'customer-user';
const NOW = new Date('2026-06-07T12:00:00Z');

function mk(over: Partial<Order>): Order {
  return {
    therapistUserId: T,
    customerId: C,
    currencyCode: 'THB', // 默认法币模式
    status: 'PENDING_CONFIRM',
    scheduledAt: null,
    // 其余字段单测用不到,用 cast 收口
    ...over,
  } as Order;
}

describe('computeViewerActions · 状态机×双端视图矩阵', () => {
  it('待确认:技师可 confirm,客户不可', () => {
    expect(computeViewerActions(mk({ status: 'PENDING_CONFIRM' }), T, NOW)).toContain('confirm');
    expect(computeViewerActions(mk({ status: 'PENDING_CONFIRM' }), C, NOW)).not.toContain('confirm');
  });

  it('已锁定·法币:技师可 confirm_offline_paid,客户无 pay', () => {
    const t = computeViewerActions(mk({ status: 'LOCKED', currencyCode: 'THB' }), T, NOW);
    expect(t).toContain('confirm_offline_paid');
    const c = computeViewerActions(mk({ status: 'LOCKED', currencyCode: 'THB' }), C, NOW);
    expect(c).not.toContain('pay');
  });

  it('已锁定·积分:客户可 pay,技师无 confirm_offline_paid', () => {
    const c = computeViewerActions(mk({ status: 'LOCKED', currencyCode: null }), C, NOW);
    expect(c).toContain('pay');
    const t = computeViewerActions(mk({ status: 'LOCKED', currencyCode: null }), T, NOW);
    expect(t).not.toContain('confirm_offline_paid');
  });

  it('已付款:技师可 start', () => {
    expect(computeViewerActions(mk({ status: 'PAID' }), T, NOW)).toContain('start');
  });

  it('服务中:技师可 complete', () => {
    expect(computeViewerActions(mk({ status: 'IN_SERVICE' }), T, NOW)).toContain('complete');
  });

  it('已完成:客户可 review,技师无主路径操作', () => {
    expect(computeViewerActions(mk({ status: 'COMPLETED' }), C, NOW)).toContain('review');
    const t = computeViewerActions(mk({ status: 'COMPLETED' }), T, NOW);
    expect(t).not.toContain('confirm');
    expect(t).not.toContain('start');
  });

  it('no-show 受 30min 门控:到点前不出现,过 30min 才出现', () => {
    const scheduledAt = new Date('2026-06-07T11:00:00Z'); // NOW 已过 60min
    const early = new Date('2026-06-07T11:10:00Z'); // 仅过 10min
    expect(computeViewerActions(mk({ status: 'PAID', scheduledAt }), T, NOW)).toContain('customer_no_show');
    expect(computeViewerActions(mk({ status: 'PAID', scheduledAt }), T, early)).not.toContain('customer_no_show');
    expect(computeViewerActions(mk({ status: 'PAID', scheduledAt }), C, NOW)).toContain('therapist_no_show');
  });

  it('非参与方 → 空', () => {
    expect(computeViewerActions(mk({ status: 'PAID' }), 'stranger', NOW)).toEqual([]);
    expect(computeViewerActions(mk({ status: 'PAID' }), undefined, NOW)).toEqual([]);
  });

  it('异常操作:确认前后可 cancel;PAID 后可 dispute', () => {
    expect(computeViewerActions(mk({ status: 'PENDING_CONFIRM' }), T, NOW)).toContain('cancel');
    expect(computeViewerActions(mk({ status: 'PAID' }), C, NOW)).toContain('dispute');
    expect(computeViewerActions(mk({ status: 'IN_SERVICE' }), T, NOW)).not.toContain('cancel');
  });

  it('终态:无任何操作', () => {
    for (const s of ['CANCELLED', 'REFUNDED', 'CLOSED'] as const) {
      expect(computeViewerActions(mk({ status: s }), T, NOW)).toEqual([]);
      expect(computeViewerActions(mk({ status: s }), C, NOW)).toEqual([]);
    }
  });
});
