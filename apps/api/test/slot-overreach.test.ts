/**
 * 时段级越权校验 · 纯函数单测
 * 跑：cd apps/api && pnpm exec vitest run test/slot-overreach.test.ts
 */
import { describe, it, expect } from 'vitest';
import { checkSlotOverreach, describeSlotHint } from '../src/services/therapist_facts';
import { parseRequestedTime } from '../src/services/timeParse';

// 墙上时间 slot(HH:MM 直读)。今天：19点可约 / 20点已被约 / 21点可约
const slot = (h: number, available: boolean) => ({
  startAt: `2026-01-01T${String(h).padStart(2, '0')}:00:00Z`,
  endAt: `2026-01-01T${String(h + 1).padStart(2, '0')}:00:00Z`,
  available,
});
const facts = {
  todaySlots: [slot(19, true), slot(20, false), slot(21, true)],
  tomorrowSlots: [slot(14, true), slot(15, false)],
};

describe('checkSlotOverreach · 只在「问的点已被约+回复肯定」时拦', () => {
  it('客户问今晚8点(已被约) + 回复答应 → 越权(拦)', () => {
    const req = parseRequestedTime('今晚8点有空吗');
    expect(checkSlotOverreach('今晚8点可以呀，来吧～', req, facts).ok).toBe(false);
  });
  it('客户问今晚8点(已被约) + 回复拒绝/改期 → 放行', () => {
    const req = parseRequestedTime('今晚8点有空吗');
    expect(checkSlotOverreach('8点那会儿没空哎，早点来嘛~', req, facts).ok).toBe(true);
  });
  it('客户问今晚9点(可约) + 回复答应 → 放行(不误杀)', () => {
    const req = parseRequestedTime('今晚9点呢');
    expect(checkSlotOverreach('9点可以呀来吧', req, facts).ok).toBe(true);
  });
  it('明天下午3点(已被约) + 答应 → 越权(拦)', () => {
    const req = parseRequestedTime('明天下午三点能约吗');
    expect(checkSlotOverreach('明天三点可以的，安排', req, facts).ok).toBe(false);
  });
  it('没问具体时间(requested null) → 放行', () => {
    expect(checkSlotOverreach('可以呀来吧', null, facts).ok).toBe(true);
  });
  it('裸"8点"歧义(parse=null) → 不拦', () => {
    const req = parseRequestedTime('8点行吗'); // null
    expect(checkSlotOverreach('行呀来吧', req, facts).ok).toBe(true);
  });
  it('slot 数据缺失 → 放行(交粗粒度兜)', () => {
    const req = parseRequestedTime('今晚8点');
    expect(checkSlotOverreach('可以呀', req, { todaySlots: [], tomorrowSlots: [] }).ok).toBe(true);
  });
});

describe('describeSlotHint · 给 prompt 的提示', () => {
  it('已被约 → 提示别答应、给真有空的点', () => {
    const h = describeSlotHint(parseRequestedTime('今晚8点'), facts);
    expect(h).toMatch(/已经有约|别答应/);
  });
  it('可约 → null(不注入)', () => {
    expect(describeSlotHint(parseRequestedTime('今晚9点'), facts)).toBeNull();
  });
  it('不在班(off) → 提示不方便', () => {
    const h = describeSlotHint(parseRequestedTime('凌晨3点'), facts); // 今天 slot 里没有 3点
    expect(h).toMatch(/不在班|不方便|不接单/);
  });
  it('没问时间 → null', () => {
    expect(describeSlotHint(null, facts)).toBeNull();
  });
});
