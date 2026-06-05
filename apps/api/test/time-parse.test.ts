/**
 * 中文相对时间解析 · 纯函数单测
 * 跑：cd apps/api && pnpm exec vitest run test/time-parse.test.ts
 */
import { describe, it, expect } from 'vitest';
import { parseRequestedTime } from '../src/services/timeParse';

const HM = (h: number, m = 0) => h * 60 + m;

describe('parseRequestedTime · 有时段词/24h 格式 → 确信解析', () => {
  it('今晚8点 → today 20:00', () => {
    const r = parseRequestedTime('今晚8点有空吗');
    expect(r).toMatchObject({ day: 'today', wallMinutes: HM(20) });
  });
  it('明天下午3点 → tomorrow 15:00', () => {
    expect(parseRequestedTime('明天下午三点能约吗')).toMatchObject({ day: 'tomorrow', wallMinutes: HM(15) });
  });
  it('明晚九点半 → tomorrow 21:30', () => {
    expect(parseRequestedTime('明晚九点半行不行')).toMatchObject({ day: 'tomorrow', wallMinutes: HM(21, 30) });
  });
  it('上午10点 → today 10:00', () => {
    expect(parseRequestedTime('上午10点')).toMatchObject({ day: 'today', wallMinutes: HM(10) });
  });
  it('凌晨2点 → today 02:00', () => {
    expect(parseRequestedTime('凌晨两点还在吗')).toMatchObject({ day: 'today', wallMinutes: HM(2) });
  });
  it('20:00 / 8:30 24h 格式', () => {
    expect(parseRequestedTime('20:00可以吗')).toMatchObject({ wallMinutes: HM(20) });
    expect(parseRequestedTime('晚上8:30')).toMatchObject({ wallMinutes: HM(20, 30) });
  });
  it('20点 24h 无时段也确信', () => {
    expect(parseRequestedTime('21点来')).toMatchObject({ wallMinutes: HM(21) });
  });
  it('晚上12点 → 0:00', () => {
    expect(parseRequestedTime('晚上12点')).toMatchObject({ wallMinutes: HM(0) });
  });
});

describe('parseRequestedTime · 歧义/无时间 → null(保守不猜)', () => {
  it('裸"8点"无时段 → null(AM/PM 歧义)', () => {
    expect(parseRequestedTime('8点有空吗')).toBeNull();
    expect(parseRequestedTime('八点呢')).toBeNull();
  });
  it('没有时间 → null', () => {
    expect(parseRequestedTime('你今天有空吗')).toBeNull();
    expect(parseRequestedTime('在吗')).toBeNull();
    expect(parseRequestedTime('')).toBeNull();
    expect(parseRequestedTime(undefined)).toBeNull();
  });
});
