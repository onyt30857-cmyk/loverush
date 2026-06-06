/**
 * 临近预约 job · UTC墙上时间→真实epoch 时区换算单测(纯函数)
 * 跑：cd apps/api && pnpm exec vitest run test/pre-appointment-tz.test.ts
 */
import { describe, it, expect } from 'vitest';
import { realEpoch } from '../src/jobs/ai-alter-pre-appointment';

describe('realEpoch · UTC墙上时间→真实epoch', () => {
  it('曼谷(+7):墙上19:00Z → 真实是12:00Z', () => {
    const got = realEpoch('2026-06-08T19:00:00Z', 'Asia/Bangkok');
    expect(got).toBe(Date.parse('2026-06-08T12:00:00Z')); // 19:00 墙上 - 7h = 12:00 UTC
  });
  it('新加坡(+8):墙上20:00Z → 真实12:00Z', () => {
    expect(realEpoch('2026-06-08T20:00:00Z', 'Asia/Singapore')).toBe(Date.parse('2026-06-08T12:00:00Z'));
  });
  it('UTC(+0):墙上=真实', () => {
    expect(realEpoch('2026-06-08T15:00:00Z', 'UTC')).toBe(Date.parse('2026-06-08T15:00:00Z'));
  });
  it('用于"2.5h内"判定:曼谷今晚的预约,真实时刻据此算距今', () => {
    // 真实 12:00Z;若 now=10:00Z → 距 2h(在 2.5h 窗口内)
    const real = realEpoch('2026-06-08T19:00:00Z', 'Asia/Bangkok');
    const now = Date.parse('2026-06-08T10:00:00Z');
    const ms = real - now;
    expect(ms).toBe(2 * 3_600_000);
    expect(ms > 0 && ms <= 2.5 * 3_600_000).toBe(true);
  });
});
