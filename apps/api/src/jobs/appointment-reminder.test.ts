import { describe, it, expect } from 'vitest';
import { classifyReminder } from './appointment-reminder';

// classifyReminder(minutesUntil, sent1h, sent10m) → { fire1h: boolean; fire10m: boolean }
describe('classifyReminder', () => {
  it('刚好 60 分：触发 1h 档', () => {
    expect(classifyReminder(60, false, false)).toEqual({ fire1h: true, fire10m: false });
  });
  it('61 分：还没到 1h 档', () => {
    expect(classifyReminder(61, false, false)).toEqual({ fire1h: false, fire10m: false });
  });
  it('30 分（1h 档窗口内、未发过）：补发 1h 档', () => {
    expect(classifyReminder(30, false, false)).toEqual({ fire1h: true, fire10m: false });
  });
  it('30 分但 1h 已发过：不重复', () => {
    expect(classifyReminder(30, true, false)).toEqual({ fire1h: false, fire10m: false });
  });
  it('刚好 10 分：触发 10m 档（不再触发 1h）', () => {
    expect(classifyReminder(10, false, false)).toEqual({ fire1h: false, fire10m: true });
  });
  it('5 分（10m 窗口内、未发过）：触发 10m', () => {
    expect(classifyReminder(5, true, false)).toEqual({ fire1h: false, fire10m: true });
  });
  it('5 分但 10m 已发过：不重复', () => {
    expect(classifyReminder(5, true, true)).toEqual({ fire1h: false, fire10m: false });
  });
  it('0 分及以下：都不触发（已到点/过点）', () => {
    expect(classifyReminder(0, false, false)).toEqual({ fire1h: false, fire10m: false });
    expect(classifyReminder(-5, false, false)).toEqual({ fire1h: false, fire10m: false });
  });
});
