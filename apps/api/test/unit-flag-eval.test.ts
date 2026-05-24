/**
 * 单元测试 · flags.ts 评估纯逻辑（不依赖 PG）
 *
 * 重点验证：
 * - bucket() SHA-256 确定性 + 分桶均匀
 * - semverLt() 语义化版本比较（含 1.10 > 1.9 等坑）
 * - matchTargeting() 多条件组合命中
 */

import { describe, it, expect } from 'vitest';
import type { FeatureFlag } from '@loverush/db';
import { bucket, matchTargeting, semverLt } from '../src/services/flags';

// ──────────────── bucket ────────────────

describe('bucket() · SHA-256 散列分桶', () => {
  it('同 (userId, flagKey) 必须返回同分桶值（确定性）', async () => {
    const a = await bucket('user-001', 'new-feature');
    const b = await bucket('user-001', 'new-feature');
    expect(a).toBe(b);
  });

  it('值域必须在 [0, 9999]（10000 桶）', async () => {
    for (let i = 0; i < 50; i++) {
      const v = await bucket(`u-${i}`, 'flag');
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10000);
    }
  });

  it('不同 userId 同 flag 应分散（500 用户分布应大致均匀）', async () => {
    const buckets: number[] = [];
    for (let i = 0; i < 500; i++) {
      buckets.push(await bucket(`user-${i}`, 'flag-x'));
    }
    // 0-2500 / 2500-5000 / 5000-7500 / 7500-10000 四分位每个都应 >= 70 个
    const q = [0, 0, 0, 0];
    for (const b of buckets) q[Math.floor(b / 2500)]!++;
    for (const c of q) {
      expect(c).toBeGreaterThan(70); // 期望 ~125，给宽松下限
    }
  });

  it('同 userId 不同 flag 应不同分桶（绝大多数情况下）', async () => {
    const a = await bucket('user-001', 'feat-a');
    const b = await bucket('user-001', 'feat-b');
    expect(a).not.toBe(b);
  });
});

// ──────────────── semverLt ────────────────

describe('semverLt() · 语义化版本比较', () => {
  it('基础大小', () => {
    expect(semverLt('1.0.0', '1.0.1')).toBe(true);
    expect(semverLt('1.0.1', '1.0.0')).toBe(false);
    expect(semverLt('1.0.0', '1.0.0')).toBe(false);
  });

  it('1.10 不应被错认为 < 1.9（按段数字比较，非字典序）', () => {
    expect(semverLt('1.10.0', '1.9.0')).toBe(false);
    expect(semverLt('1.9.0', '1.10.0')).toBe(true);
  });

  it('跨主版本号', () => {
    expect(semverLt('1.99.99', '2.0.0')).toBe(true);
    expect(semverLt('2.0.0', '1.99.99')).toBe(false);
  });

  it('短版本（缺失段视为 0）', () => {
    expect(semverLt('1.2', '1.2.1')).toBe(true);
    expect(semverLt('1', '1.0.0')).toBe(false);
    expect(semverLt('1.0', '1.0.0')).toBe(false);
  });

  it('patch 版本差', () => {
    expect(semverLt('3.2.5', '3.2.10')).toBe(true);
    expect(semverLt('3.2.10', '3.2.5')).toBe(false);
  });
});

// ──────────────── matchTargeting ────────────────

function mkFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: 'flag-1',
    key: 'test',
    description: null,
    enabled: 1,
    defaultEnabled: 0,
    rolloutBps: 0,
    targetUserType: null,
    targetLocales: null,
    targetCities: null,
    targetMinAppVersion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as FeatureFlag;
}

describe('matchTargeting() · targeting 规则', () => {
  it('未声明任何 targeting → false（没规则就别命中，靠后面的 rollout/default）', () => {
    expect(matchTargeting(mkFlag(), { userId: 'u1' })).toBe(false);
  });

  it('targetUserType 单独命中 → true', () => {
    const flag = mkFlag({ targetUserType: 'customer' });
    expect(matchTargeting(flag, { userType: 'customer' })).toBe(true);
    expect(matchTargeting(flag, { userType: 'therapist' })).toBe(false);
  });

  it('targetLocales 命中 → true，不在列表 → false', () => {
    const flag = mkFlag({ targetLocales: ['zh', 'th'] });
    expect(matchTargeting(flag, { locale: 'zh' })).toBe(true);
    expect(matchTargeting(flag, { locale: 'th' })).toBe(true);
    expect(matchTargeting(flag, { locale: 'en' })).toBe(false);
    expect(matchTargeting(flag, {})).toBe(false);
  });

  it('targetCities 与 locales 组合 AND 命中', () => {
    const flag = mkFlag({ targetLocales: ['zh'], targetCities: ['Bangkok'] });
    expect(matchTargeting(flag, { locale: 'zh', city: 'Bangkok' })).toBe(true);
    expect(matchTargeting(flag, { locale: 'zh', city: 'KL' })).toBe(false);
    expect(matchTargeting(flag, { locale: 'en', city: 'Bangkok' })).toBe(false);
  });

  it('targetMinAppVersion 比较', () => {
    const flag = mkFlag({ targetCities: ['Bangkok'], targetMinAppVersion: '1.5.0' });
    expect(matchTargeting(flag, { city: 'Bangkok', appVersion: '1.5.0' })).toBe(true);
    expect(matchTargeting(flag, { city: 'Bangkok', appVersion: '1.6.0' })).toBe(true);
    expect(matchTargeting(flag, { city: 'Bangkok', appVersion: '1.4.9' })).toBe(false);
  });

  it('targetUserType + targetLocales 组合（AND 关系）', () => {
    const flag = mkFlag({ targetUserType: 'therapist', targetLocales: ['vi'] });
    expect(matchTargeting(flag, { userType: 'therapist', locale: 'vi' })).toBe(true);
    expect(matchTargeting(flag, { userType: 'customer', locale: 'vi' })).toBe(false);
    expect(matchTargeting(flag, { userType: 'therapist', locale: 'zh' })).toBe(false);
  });

  it('未传 appVersion 时忽略版本规则（不报错）', () => {
    const flag = mkFlag({ targetCities: ['Bangkok'], targetMinAppVersion: '1.5.0' });
    expect(matchTargeting(flag, { city: 'Bangkok' })).toBe(true);
  });
});
