/**
 * 单元测试 · personalize.ts 评分纯函数
 *
 * 不涉及 db · 直接调 scoreCandidates(candidates, inputs)
 *
 * 覆盖:
 * - 基础分(scoreService/10 + online)
 * - 历史复购最强信号 (+50)
 * - L4 relation importance + 好评关键词额外加分
 * - 偏好命中(语言/国籍/同城) 各 20/20/15
 * - dislike 强避雷 -100
 * - behavior mode (steady-已浏览 / explorer-新发现)
 * - 最终排序 (booked 高于普通 / dislike 沉底)
 * - reasons 上限 2 条 + 优先级
 */

import { describe, it, expect } from 'vitest';
import { scoreCandidates, type TherapistCandidate, type ScoringInputs } from '../src/services/personalize';

function makeT(overrides: Partial<TherapistCandidate> & { id: string; userId: string }): TherapistCandidate {
  return {
    displayName: 'T',
    serviceCity: null,
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

describe('Unit · personalize · 评分基线', () => {
  it('全空输入 · 基础分 = scoreService/10 · 无 reasons (低于 45)', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates([t], emptyInputs());
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeCloseTo(4); // 40/10
    expect(out[0]!.reasons).toEqual([]);
  });

  it('在线 · +5 + reason "在线"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40, onlineStatus: 'online' });
    const out = scoreCandidates([t], emptyInputs());
    expect(out[0]!.score).toBeCloseTo(9); // 4 + 5
    expect(out[0]!.reasons).toContain('在线');
  });

  it('scoreService≥45 · 无别 reason 时回填 "X★ 口碑稳"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 48 });
    const out = scoreCandidates([t], emptyInputs());
    expect(out[0]!.reasons[0]).toMatch(/4\.8★ 口碑稳/);
  });
});

describe('Unit · personalize · 历史复购 (最强信号)', () => {
  it('booked +50 + reason "约过 · 老熟人"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates([t], emptyInputs({ bookedTherapistUserIds: new Set(['u1']) }));
    expect(out[0]!.score).toBeCloseTo(54); // 4 + 50
    expect(out[0]!.reasons).toContain('约过 · 老熟人');
  });

  it('booked 技师永远排在新技师前(60 vs 38)', () => {
    const old = makeT({ id: 'tOld', userId: 'uOld', scoreService: 30 }); // 基础 3 + 50 booked
    const top = makeT({ id: 'tTop', userId: 'uTop', scoreService: 48, onlineStatus: 'online' }); // 4.8 + 5 + 4.8★ tag
    const out = scoreCandidates(
      [top, old],
      emptyInputs({ bookedTherapistUserIds: new Set(['uOld']) }),
    );
    expect(out[0]!.therapist.id).toBe('tOld');
    expect(out[1]!.therapist.id).toBe('tTop');
  });
});

describe('Unit · personalize · L4 relation 关系层', () => {
  it('importance 8 + 好评关键词 · score += 8*5 + 15', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates(
      [t],
      emptyInputs({
        relationsByTherapist: new Map([['t1', [{ content: '手法对、好舒服', importance: 8 }]]]),
      }),
    );
    expect(out[0]!.score).toBeCloseTo(4 + 40 + 15); // base + importance*5 + 好评
    expect(out[0]!.reasons).toContain('你上次说好');
  });

  it('无好评关键词 · 只加 importance*5 · 不加 "你上次说好"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates(
      [t],
      emptyInputs({
        relationsByTherapist: new Map([['t1', [{ content: '约过一次', importance: 5 }]]]),
      }),
    );
    expect(out[0]!.score).toBeCloseTo(4 + 25);
    expect(out[0]!.reasons).not.toContain('你上次说好');
  });
});

describe('Unit · personalize · 偏好命中', () => {
  it('同城 +15 + reason "同城"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40, serviceCity: '曼谷' });
    const out = scoreCandidates([t], emptyInputs({ facts: { city: '曼谷' } }));
    expect(out[0]!.score).toBeCloseTo(4 + 15);
    expect(out[0]!.reasons).toContain('同城');
  });

  it('priorities 命中语言 +20 + reason "语言匹配"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40, languages: ['中文', '泰语'] });
    const out = scoreCandidates(
      [t],
      emptyInputs({ stablePrefs: { priorities: ['中文'] } }),
    );
    expect(out[0]!.score).toBeCloseTo(4 + 20);
    expect(out[0]!.reasons).toContain('语言匹配');
  });

  it('priorities 命中国籍 +20 (静默 · 不入 reason 占位)', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40, nationality: '泰国' });
    const out = scoreCandidates(
      [t],
      emptyInputs({ stablePrefs: { priorities: ['泰国'] } }),
    );
    expect(out[0]!.score).toBeCloseTo(4 + 20);
  });
});

describe('Unit · personalize · dislike 强避雷', () => {
  it('国籍命中 dislike · score -= 100 · 沉到最底', () => {
    const ok = makeT({ id: 'tOk', userId: 'uOk', scoreService: 40 });
    const bad = makeT({ id: 'tBad', userId: 'uBad', scoreService: 48, nationality: '韩国' });
    const out = scoreCandidates(
      [bad, ok],
      emptyInputs({ stablePrefs: { dislikes: ['韩国'] } }),
    );
    expect(out[0]!.therapist.id).toBe('tOk'); // 4 分
    expect(out[1]!.therapist.id).toBe('tBad'); // 4.8 - 100 = -95
    expect(out[1]!.score).toBeLessThan(0);
  });

  it('语言命中 dislike 也 -100', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40, languages: ['日语'] });
    const out = scoreCandidates(
      [t],
      emptyInputs({ stablePrefs: { dislikes: ['日语'] } }),
    );
    expect(out[0]!.score).toBeCloseTo(4 - 100);
  });
});

describe('Unit · personalize · behavior mode', () => {
  it('steady + 已浏览过 · +15', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates(
      [t],
      emptyInputs({ mode: 'steady', viewedTherapistIds: new Set(['t1']) }),
    );
    expect(out[0]!.score).toBeCloseTo(4 + 15);
  });

  it('explorer + 没见过 · +10 + reason "新发现"', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates([t], emptyInputs({ mode: 'explorer' }));
    expect(out[0]!.score).toBeCloseTo(4 + 10);
    expect(out[0]!.reasons).toContain('新发现');
  });

  it('mixed mode · 行为模式不加分', () => {
    const t = makeT({ id: 't1', userId: 'u1', scoreService: 40 });
    const out = scoreCandidates(
      [t],
      emptyInputs({ mode: 'mixed', viewedTherapistIds: new Set(['t1']) }),
    );
    expect(out[0]!.score).toBeCloseTo(4);
  });
});

describe('Unit · personalize · 综合排序 + reasons 上限', () => {
  it('完整赛跑 · booked 高于偏好命中高于在线高于普通', () => {
    const booked = makeT({ id: 'tA', userId: 'uA', scoreService: 30 });
    const pref = makeT({ id: 'tB', userId: 'uB', scoreService: 40, serviceCity: '曼谷', languages: ['中文'] });
    const online = makeT({ id: 'tC', userId: 'uC', scoreService: 40, onlineStatus: 'online' });
    const plain = makeT({ id: 'tD', userId: 'uD', scoreService: 30 });

    const out = scoreCandidates(
      [plain, online, pref, booked],
      emptyInputs({
        bookedTherapistUserIds: new Set(['uA']),
        facts: { city: '曼谷' },
        stablePrefs: { priorities: ['中文'] },
      }),
    );
    expect(out.map((r) => r.therapist.id)).toEqual(['tA', 'tB', 'tC', 'tD']);
  });

  it('reasons 至多 2 条 · 多命中只保留前两', () => {
    const t = makeT({
      id: 't1',
      userId: 'u1',
      scoreService: 48,
      onlineStatus: 'online',
      serviceCity: '曼谷',
      languages: ['中文'],
    });
    const out = scoreCandidates(
      [t],
      emptyInputs({
        bookedTherapistUserIds: new Set(['u1']),
        facts: { city: '曼谷' },
        stablePrefs: { priorities: ['中文'] },
      }),
    );
    expect(out[0]!.reasons.length).toBeLessThanOrEqual(2);
  });
});
