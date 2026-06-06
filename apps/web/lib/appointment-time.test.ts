import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apptLocalDate, absLabel, countdownLabel } from './appointment-time';

describe('apptLocalDate', () => {
  it('把 UTC 墙上分量当本地分量构造', () => {
    const d = apptLocalDate('2026-06-10T14:30:00.000Z');
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    expect(d.getDate()).toBe(10);
    expect(d.getMonth()).toBe(5); // 6月=5
  });
});

describe('absLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 9, 0, 0)); // 2026-06-10 09:00 本地
  });
  afterEach(() => vi.useRealTimers());

  it('今天', () => {
    expect(absLabel(new Date(2026, 5, 10, 14, 5))).toBe('今天 14:05');
  });
  it('明天', () => {
    expect(absLabel(new Date(2026, 5, 11, 9, 0))).toBe('明天 09:00');
  });
  it('后天', () => {
    expect(absLabel(new Date(2026, 5, 12, 18, 30))).toBe('后天 18:30');
  });
  it('本周内（>2 <7 天）显示周X', () => {
    // 2026-06-13 是周六
    expect(absLabel(new Date(2026, 5, 13, 10, 0))).toBe('周六 10:00');
  });
  it('超 7 天显示月日', () => {
    expect(absLabel(new Date(2026, 5, 20, 10, 0))).toBe('6月20日 10:00');
  });
});

describe('countdownLabel', () => {
  const name = '小雅';
  it('已过点返回 null', () => {
    const appt = new Date(2026, 5, 10, 9, 0);
    expect(countdownLabel(appt, appt.getTime() + 60_000, name)).toBeNull();
  });
  it('30 分钟内：马上见面', () => {
    const appt = new Date(2026, 5, 10, 9, 20);
    const now = new Date(2026, 5, 10, 9, 0).getTime(); // 还剩 20 分
    expect(countdownLabel(appt, now, name)).toBe(`马上就能见到${name}啦 ✨`);
  });
  it('30~180 分钟：还有 N 小时 M 分', () => {
    const appt = new Date(2026, 5, 10, 11, 30);
    const now = new Date(2026, 5, 10, 9, 0).getTime(); // 还剩 2h30m
    expect(countdownLabel(appt, now, name)).toBe('还有 2 小时 30 分就见面');
  });
  it('当天但 >180 分钟：就在今天', () => {
    const appt = new Date(2026, 5, 10, 18, 0);
    const now = new Date(2026, 5, 10, 9, 0).getTime(); // 还剩 9h，同一天
    expect(countdownLabel(appt, now, name)).toBe('就在今天 · 期待和你见面');
  });
  it('跨天：还有 N 天', () => {
    const appt = new Date(2026, 5, 13, 10, 0);
    const now = new Date(2026, 5, 10, 9, 0).getTime();
    expect(countdownLabel(appt, now, name)).toBe(`还有 3 天就见到${name}`);
  });
  it('边界 min=30：进"还有 N 小时"档，h=0 时也输出"0 小时"', () => {
    // appt - now = 30min，min<180 进第二分支，h=0 m=30
    const now = new Date(2026, 5, 10, 9, 0).getTime();
    const appt = new Date(2026, 5, 10, 9, 30);
    expect(countdownLabel(appt, now, name)).toBe('还有 0 小时 30 分就见面');
  });
  it('跨天 days 分支回归：后天上午，差 46h，应得"还有 2 天"', () => {
    // min=2760>=180，day=6月12日，today=6月10日，days=2
    const now = new Date(2026, 5, 10, 12, 0).getTime();
    const appt = new Date(2026, 5, 12, 10, 0);
    expect(countdownLabel(appt, now, name)).toBe(`还有 2 天就见到${name}`);
  });
});
