/**
 * 单元测试 · decideChannels 纯函数(决定群发投递渠道)
 *
 * 关键场景:
 *  - 用户偏好关 promo → 不投 web_push
 *  - level=critical 穿透 quiet hour
 *  - bypassUserPrefs 强制 in_app + web_push
 *  - level=silent 永不 web_push
 *  - 用户没建 prefs 行 → 默认全开
 */

import { describe, it, expect } from 'vitest';
import { decideChannels } from '../src/services/broadcast';
import type { UserPushPreference } from '@loverush/db';

function p(overrides: Partial<UserPushPreference> = {}): UserPushPreference {
  return {
    id: 'p1',
    userId: 'u1',
    chatMsgEnabled: 1,
    orderStatusEnabled: 1,
    dispatchOfferEnabled: 1,
    reviewEnabled: 1,
    withdrawEnabled: 1,
    promoEnabled: 1,
    quietHoursStart: null,
    quietHoursEnd: null,
    quietTimezone: null,
    webPushDailyCap: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserPushPreference;
}

describe('Unit · decideChannels · bypassUserPrefs', () => {
  it('bypass=true · 强制 in_app+web_push', () => {
    const ch = decideChannels({
      prefs: p({ promoEnabled: 0 }),
      level: 'critical',
      category: 'promo',
      bypassUserPrefs: true,
    });
    expect(ch).toEqual(['in_app', 'web_push']);
  });

  it('bypass=true + level=silent · 仍只 in_app', () => {
    const ch = decideChannels({
      prefs: p(),
      level: 'silent',
      category: 'promo',
      bypassUserPrefs: true,
    });
    expect(ch).toEqual(['in_app']);
  });
});

describe('Unit · decideChannels · 用户偏好关闭类目', () => {
  it('promo 关 · 仅 in_app', () => {
    const ch = decideChannels({
      prefs: p({ promoEnabled: 0 }),
      level: 'info',
      category: 'promo',
      bypassUserPrefs: false,
    });
    expect(ch).toEqual(['in_app']);
  });

  it('promo 关 + system 通知 · web_push 仍走(orderStatus 开)', () => {
    const ch = decideChannels({
      prefs: p({ promoEnabled: 0, orderStatusEnabled: 1 }),
      level: 'info',
      category: 'system',
      bypassUserPrefs: false,
    });
    expect(ch).toContain('web_push');
  });
});

describe('Unit · decideChannels · level=silent', () => {
  it('silent 永不 web_push · 即使 bypass', () => {
    const ch = decideChannels({
      prefs: p(),
      level: 'silent',
      category: 'promo',
      bypassUserPrefs: true,
    });
    expect(ch).toEqual(['in_app']);
  });

  it('silent · 普通投递 · 仅 in_app', () => {
    const ch = decideChannels({
      prefs: p(),
      level: 'silent',
      category: 'promo',
      bypassUserPrefs: false,
    });
    expect(ch).toEqual(['in_app']);
  });
});

describe('Unit · decideChannels · quiet hour', () => {
  it('在 quiet hour + level=info · 仅 in_app', () => {
    // 22:00-07:00 quiet · now=23:30
    const ch = decideChannels({
      prefs: p({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      level: 'info',
      category: 'promo',
      bypassUserPrefs: false,
      now: new Date('2026-05-30T23:30:00'),
    });
    expect(ch).toEqual(['in_app']);
  });

  it('在 quiet hour + level=critical · 仍投 web_push(穿透)', () => {
    const ch = decideChannels({
      prefs: p({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      level: 'critical',
      category: 'promo',
      bypassUserPrefs: false,
      now: new Date('2026-05-30T23:30:00'),
    });
    expect(ch).toContain('web_push');
  });

  it('不在 quiet hour · 正常投', () => {
    const ch = decideChannels({
      prefs: p({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }),
      level: 'info',
      category: 'promo',
      bypassUserPrefs: false,
      now: new Date('2026-05-30T15:00:00'),
    });
    expect(ch).toContain('web_push');
  });
});

describe('Unit · decideChannels · 无 prefs(新用户)', () => {
  it('prefs=null · 默认全开', () => {
    const ch = decideChannels({
      prefs: null,
      level: 'info',
      category: 'promo',
      bypassUserPrefs: false,
    });
    expect(ch).toEqual(['in_app', 'web_push']);
  });

  it('prefs=null + level=silent · 仅 in_app', () => {
    const ch = decideChannels({
      prefs: null,
      level: 'silent',
      category: 'promo',
      bypassUserPrefs: false,
    });
    expect(ch).toEqual(['in_app']);
  });
});
