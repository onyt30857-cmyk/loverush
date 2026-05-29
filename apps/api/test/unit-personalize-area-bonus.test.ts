/**
 * 单元测试 · personalize 同城/同区加分(M02 Phase 5)
 *
 * 关键场景:
 *  - cityId 命中 +15 同城
 *  - cityId + areaId 命中 +25 同城+同区
 *  - cityId 不命中只 areaId 不应加分(逻辑保护:跨城同区不合理)
 *  - 旧 text 兼容:cityId 缺但 city text 命中 → 也 +15
 */

import { describe, it, expect } from 'vitest';
import { scoreCandidates, type TherapistCandidate, type ScoringInputs } from '../src/services/personalize';

function t(overrides: Partial<TherapistCandidate> & { id: string; userId: string }): TherapistCandidate {
  return {
    displayName: 'T',
    serviceCity: null,
    serviceCityId: null,
    serviceAreaId: null,
    nationality: null,
    languages: null,
    scoreService: 40,
    onlineStatus: 'offline',
    ...overrides,
  };
}

function emptyInputs(overrides: Partial<ScoringInputs> = {}): ScoringInputs {
  return {
    stablePrefs: {},
    facts: {},
    relationsByTherapist: new Map(),
    bookedTherapistUserIds: new Set(),
    mode: 'mixed',
    viewedTherapistIds: new Set(),
    ...overrides,
  };
}

describe('Unit · personalize 同城/同区(M02 Phase 5)', () => {
  it('cityId 命中 → +15 + 同城 reason', () => {
    const candidate = t({ id: 't1', userId: 'u1', serviceCityId: 'bangkok-id' });
    const out = scoreCandidates([candidate], emptyInputs({ facts: { cityId: 'bangkok-id' } }));
    expect(out[0]!.score).toBeCloseTo(4 + 15); // 基础 + 同城
    expect(out[0]!.reasons).toContain('同城');
  });

  it('cityId + areaId 同时命中 → +25', () => {
    const candidate = t({
      id: 't1',
      userId: 'u1',
      serviceCityId: 'bangkok-id',
      serviceAreaId: 'asok-id',
    });
    const out = scoreCandidates(
      [candidate],
      emptyInputs({ facts: { cityId: 'bangkok-id', areaId: 'asok-id' } }),
    );
    expect(out[0]!.score).toBeCloseTo(4 + 15 + 10);
    expect(out[0]!.reasons).toContain('同城');
  });

  it('cityId 不同 · areaId 相同 → 只 areaId 加 +10', () => {
    const candidate = t({
      id: 't1',
      userId: 'u1',
      serviceCityId: 'chiang-mai-id',
      serviceAreaId: 'asok-id',
    });
    const out = scoreCandidates(
      [candidate],
      emptyInputs({ facts: { cityId: 'bangkok-id', areaId: 'asok-id' } }),
    );
    // 不同城 · 不加 +15 · 只 +10(同区)
    expect(out[0]!.score).toBeCloseTo(4 + 10);
  });

  it('旧 text city 兼容 · 没 cityId 时用 serviceCity === facts.city', () => {
    const candidate = t({ id: 't1', userId: 'u1', serviceCity: '曼谷' });
    const out = scoreCandidates([candidate], emptyInputs({ facts: { city: '曼谷' } }));
    expect(out[0]!.score).toBeCloseTo(4 + 15);
    expect(out[0]!.reasons).toContain('同城');
  });

  it('cityId 优先 · text 失配但 id 命中 → 仍 +15', () => {
    const candidate = t({
      id: 't1',
      userId: 'u1',
      serviceCity: 'Bangkok',
      serviceCityId: 'bangkok-id',
    });
    const out = scoreCandidates(
      [candidate],
      emptyInputs({ facts: { city: '曼谷', cityId: 'bangkok-id' } }),
    );
    // city text='Bangkok' vs facts.city='曼谷' 不命中 · 但 cityId 命中 → 加分
    expect(out[0]!.score).toBeCloseTo(4 + 15);
  });

  it('完全不同地点 · 不加分', () => {
    const candidate = t({
      id: 't1',
      userId: 'u1',
      serviceCity: 'Phuket',
      serviceCityId: 'phuket-id',
    });
    const out = scoreCandidates(
      [candidate],
      emptyInputs({ facts: { cityId: 'bangkok-id', city: '曼谷' } }),
    );
    expect(out[0]!.score).toBeCloseTo(4); // 只有基础分
  });
});
