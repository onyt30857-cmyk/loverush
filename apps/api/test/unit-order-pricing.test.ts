/**
 * 单元测试 · computeOrderPricing 纯积分路径(心动金闭环核心口径)
 *
 * 覆盖:"所有订单都算 depositPoints" —— 非法币订单按 serviceSnapshot.pricePoints × 10% 冻结。
 * 法币(sourceShowId)路径要查 show + 汇率,留给 e2e。
 */
import { describe, it, expect } from 'vitest';
import { computeOrderPricing } from '../src/services/orders';

// 非法币路径不触达 db,给个占位 ctx 即可
const ctx = { db: {} as never };

function snap(pricePoints: number) {
  return { skills: ['精油'], durationMin: 60, pricePoints };
}

describe('computeOrderPricing · 纯积分订单心动金', () => {
  it('整百价 1000 → 冻结 10% = 100', async () => {
    const r = await computeOrderPricing(ctx, { serviceSnapshot: snap(1000) });
    expect(r).toMatchObject({ currencyCode: null, totalFiat: null, totalPoints: 1000, depositPoints: 100 });
  });

  it('非整除 999 → 向上取整 ceil(99.9) = 100', async () => {
    const r = await computeOrderPricing(ctx, { serviceSnapshot: snap(999) });
    expect(r.depositPoints).toBe(100);
  });

  it('小额 5 → ceil(0.5) = 1(绝不为 0,守住"零余额拦截"防线)', async () => {
    const r = await computeOrderPricing(ctx, { serviceSnapshot: snap(5) });
    expect(r.depositPoints).toBe(1);
  });

  it('0 价 → 0(免保证金单,submit 会跳过冻结)', async () => {
    const r = await computeOrderPricing(ctx, { serviceSnapshot: snap(0) });
    expect(r.depositPoints).toBe(0);
  });

  it('负价兜底为 0(脏数据不致负冻结)', async () => {
    const r = await computeOrderPricing(ctx, { serviceSnapshot: snap(-100) });
    expect(r.totalPoints).toBe(0);
    expect(r.depositPoints).toBe(0);
  });
});
