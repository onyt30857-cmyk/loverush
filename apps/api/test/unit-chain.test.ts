/**
 * 单元测试 · chain.ts（纯函数，不依赖 PG）
 *
 * 重点验证：
 * - hash 链确定性（相同输入永远产生相同 hash）
 * - 顺序敏感（seq / prevHash 改变 → hash 不同）
 * - 经典攻击：同 payload 不同顺序应产生不同 hash
 */

import { describe, it, expect } from 'vitest';
import { computeEventHash, computePriceLockHash, GENESIS_HASH } from '../src/services/chain';

describe('Unit · chain hash 链', () => {
  it('相同输入产生相同 hash（确定性）', async () => {
    const args = {
      prevHash: GENESIS_HASH,
      seq: 1,
      eventType: 'order_created',
      payload: { orderId: 'abc', price: 200 },
    };
    const h1 = await computeEventHash(args);
    const h2 = await computeEventHash(args);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('prevHash 改变 → hash 改变', async () => {
    const base = { seq: 1, eventType: 'paid', payload: { x: 1 } };
    const h1 = await computeEventHash({ ...base, prevHash: 'AAA' });
    const h2 = await computeEventHash({ ...base, prevHash: 'BBB' });
    expect(h1).not.toBe(h2);
  });

  it('seq 改变 → hash 改变', async () => {
    const base = { prevHash: GENESIS_HASH, eventType: 'paid', payload: { x: 1 } };
    const h1 = await computeEventHash({ ...base, seq: 1 });
    const h2 = await computeEventHash({ ...base, seq: 2 });
    expect(h1).not.toBe(h2);
  });

  it('eventType 改变 → hash 改变', async () => {
    const base = { prevHash: GENESIS_HASH, seq: 1, payload: { x: 1 } };
    const h1 = await computeEventHash({ ...base, eventType: 'paid' });
    const h2 = await computeEventHash({ ...base, eventType: 'cancelled' });
    expect(h1).not.toBe(h2);
  });

  it('payload key 顺序不影响 hash（canonicalize 排序）', async () => {
    const base = { prevHash: GENESIS_HASH, seq: 1, eventType: 'paid' };
    const h1 = await computeEventHash({ ...base, payload: { a: 1, b: 2 } });
    const h2 = await computeEventHash({ ...base, payload: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
  });

  it('payload 数组顺序敏感（攻击防护）', async () => {
    const base = { prevHash: GENESIS_HASH, seq: 1, eventType: 'paid' };
    const h1 = await computeEventHash({ ...base, payload: { items: [1, 2, 3] } });
    const h2 = await computeEventHash({ ...base, payload: { items: [3, 2, 1] } });
    expect(h1).not.toBe(h2);
  });

  it('嵌套对象正确序列化', async () => {
    const base = { prevHash: GENESIS_HASH, seq: 1, eventType: 'paid' };
    const h1 = await computeEventHash({ ...base, payload: { meta: { city: 'BKK', tier: 'L2' } } });
    const h2 = await computeEventHash({ ...base, payload: { meta: { tier: 'L2', city: 'BKK' } } });
    expect(h1).toBe(h2);
  });

  it('undefined 字段被过滤', async () => {
    const base = { prevHash: GENESIS_HASH, seq: 1, eventType: 'paid' };
    const h1 = await computeEventHash({ ...base, payload: { a: 1 } });
    const h2 = await computeEventHash({ ...base, payload: { a: 1, b: undefined } });
    expect(h1).toBe(h2);
  });

  it('null 字段不被过滤', async () => {
    const base = { prevHash: GENESIS_HASH, seq: 1, eventType: 'paid' };
    const h1 = await computeEventHash({ ...base, payload: { a: 1 } });
    const h2 = await computeEventHash({ ...base, payload: { a: 1, b: null } });
    expect(h1).not.toBe(h2);
  });

  it('GENESIS_HASH 是固定字符串', () => {
    expect(GENESIS_HASH).toBe('GENESIS');
  });
});

describe('Unit · price lock hash', () => {
  it('相同 orderId/price/snapshot/lockedAt 产生相同 hash', async () => {
    const args = {
      orderId: 'order-uuid-123',
      pricePoints: 200,
      serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
      lockedAt: new Date('2026-05-21T10:00:00Z'),
    };
    const h1 = await computePriceLockHash(args);
    const h2 = await computePriceLockHash(args);
    expect(h1).toBe(h2);
  });

  it('价格改变 → hash 改变（核心防篡改）', async () => {
    const base = {
      orderId: 'order-uuid-123',
      serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
      lockedAt: new Date('2026-05-21T10:00:00Z'),
    };
    const h1 = await computePriceLockHash({ ...base, pricePoints: 200 });
    const h2 = await computePriceLockHash({ ...base, pricePoints: 201 });
    expect(h1).not.toBe(h2);
  });

  it('snapshot 改变 → hash 改变（防偷加项）', async () => {
    const base = {
      orderId: 'order-uuid-123',
      pricePoints: 200,
      lockedAt: new Date('2026-05-21T10:00:00Z'),
    };
    const h1 = await computePriceLockHash({
      ...base,
      serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
    });
    const h2 = await computePriceLockHash({
      ...base,
      serviceSnapshot: { skills: ['泰式', '精油'], durationMin: 60, pricePoints: 200 }, // 偷加项
    });
    expect(h1).not.toBe(h2);
  });
});
