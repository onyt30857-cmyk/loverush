/**
 * 单元测试 · M06→M03 回流(近期聊天互动驱动首页排序)
 *
 * 客户和某技师分身近期聊过(relationship.lastInteractionAt 活信号)→ personalize 排序加权,
 * 推进"聊过→约单"转化。纯函数 scoreCandidates,mock 输入。
 */
import { describe, it, expect } from 'vitest';
import { scoreCandidates, type ScoringInputs } from '../src/services/personalize';

const baseInputs: ScoringInputs = {
  stablePrefs: {},
  facts: {},
  relationsByTherapist: new Map(),
  bookedTherapistUserIds: new Set<string>(),
  mode: 'mixed',
  viewedTherapistIds: new Set<string>(),
  chatRecencyByTherapist: new Map<string, Date>(),
};

function cand(id: string) {
  return {
    id,
    userId: `${id}-u`,
    displayName: 'T',
    serviceCity: null,
    nationality: null,
    languages: null,
    scoreService: 0,
    onlineStatus: 'offline',
  };
}

describe('scoreCandidates · M06→M03 回流加权', () => {
  it('3天内聊过 → +18 + "最近还在聊"', () => {
    const r = scoreCandidates([cand('t1')], {
      ...baseInputs,
      chatRecencyByTherapist: new Map([['t1', new Date()]]),
    });
    expect(r[0]!.score).toBe(18);
    expect(r[0]!.reasons).toContain('最近还在聊');
  });

  it('14天内聊过 → +12 + "最近聊过"', () => {
    const r = scoreCandidates([cand('t1')], {
      ...baseInputs,
      chatRecencyByTherapist: new Map([['t1', new Date(Date.now() - 10 * 86_400_000)]]),
    });
    expect(r[0]!.score).toBe(12);
    expect(r[0]!.reasons).toContain('最近聊过');
  });

  it('超14天 → 不加权', () => {
    const r = scoreCandidates([cand('t1')], {
      ...baseInputs,
      chatRecencyByTherapist: new Map([['t1', new Date(Date.now() - 30 * 86_400_000)]]),
    });
    expect(r[0]!.score).toBe(0);
  });

  it('没聊过 → 不加权(零回归)', () => {
    expect(scoreCandidates([cand('t1')], baseInputs)[0]!.score).toBe(0);
  });

  it('约过的(+50)叠加聊过(+18)但不重复堆"老熟人"reason', () => {
    const r = scoreCandidates([cand('t1')], {
      ...baseInputs,
      bookedTherapistUserIds: new Set(['t1-u']),
      chatRecencyByTherapist: new Map([['t1', new Date()]]),
    });
    expect(r[0]!.score).toBe(68); // 50 约过 + 18 聊过
    expect(r[0]!.reasons).toContain('约过 · 老熟人');
    expect(r[0]!.reasons).not.toContain('最近还在聊'); // 已是老熟人,不重复加
  });
});
