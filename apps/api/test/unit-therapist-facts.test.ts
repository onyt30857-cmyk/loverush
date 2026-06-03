/**
 * 单元测试 · therapist_facts.ts 纯函数层（M06 AI 分身事实边界护栏）
 *
 * 覆盖：时区解析降级链、技师本地"现在"、档期口语压缩、facts block 空维度省略、
 * ④ 越权时间承诺窄保险（今日满却答应今天 → 拦；其余放行不误伤）。
 * loadTherapistFacts 的 DB 聚合留给本地 e2e。
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTz,
  localNow,
  summarizeDay,
  formatFactsBlock,
  checkFactsOverreach,
  DEFAULT_TZ,
  type TherapistFacts,
} from '../src/services/therapist_facts';
import type { AvailabilitySlot } from '../src/services/availability';

function slot(hhmm: string, available: boolean): AvailabilitySlot {
  return {
    startAt: `2026-06-03T${hhmm}:00Z`,
    endAt: `2026-06-03T${hhmm}:00Z`,
    available,
  };
}

const emptyFacts: TherapistFacts = {
  availabilityText: '',
  priceText: '',
  serviceText: '',
  locationText: '',
  todayFull: false,
};

describe('resolveTz · 时区降级链', () => {
  it('city slug 命中优先', () => {
    expect(resolveTz({ cityCode: 'bangkok' })).toBe('Asia/Bangkok');
    expect(resolveTz({ cityCode: 'kuala-lumpur', serviceCountry: 'TH' })).toBe('Asia/Kuala_Lumpur');
  });
  it('国家码次之', () => {
    expect(resolveTz({ countryCode: 'SG' })).toBe('Asia/Singapore');
    expect(resolveTz({ serviceCountry: 'vn' })).toBe('Asia/Ho_Chi_Minh');
  });
  it('serviceCity 文本兜底', () => {
    expect(resolveTz({ serviceCity: 'Jakarta' })).toBe('Asia/Jakarta');
  });
  it('全空 → 平台默认时区', () => {
    expect(resolveTz({})).toBe(DEFAULT_TZ);
    expect(resolveTz({ cityCode: 'unknown-town', countryCode: 'ZZ' })).toBe(DEFAULT_TZ);
  });
});

describe('localNow · 技师本地"现在"', () => {
  it('UTC 05:00 在曼谷(+7)=当日 12:00', () => {
    const r = localNow('Asia/Bangkok', new Date('2026-06-03T05:00:00Z'));
    expect(r.date).toBe('2026-06-03');
    expect(r.minutes).toBe(12 * 60);
  });
  it('UTC 17:00 在曼谷(+7)=次日 00:00（跨日）', () => {
    const r = localNow('Asia/Bangkok', new Date('2026-06-03T17:00:00Z'));
    expect(r.date).toBe('2026-06-04');
    expect(r.minutes).toBe(0);
  });
});

describe('summarizeDay · 档期口语压缩', () => {
  it('无排班 → 不接单 / hasFree=false', () => {
    expect(summarizeDay('今天', [], 0)).toEqual({ text: '今天没排班、不接单', hasFree: false });
  });
  it('全 available 且未过 → 都有空', () => {
    const r = summarizeDay('明天', [slot('14:00', true), slot('15:00', true)], 0);
    expect(r.hasFree).toBe(true);
    expect(r.text).toContain('都有空');
  });
  it('部分 available → 报最早空档钟点', () => {
    const r = summarizeDay('今天', [slot('14:00', false), slot('21:00', true)], 0);
    expect(r.hasFree).toBe(true);
    expect(r.text).toContain('晚上9点');
  });
  it('全 booked → 排满 / hasFree=false', () => {
    const r = summarizeDay('今天', [slot('14:00', false), slot('15:00', false)], 0);
    expect(r.hasFree).toBe(false);
    expect(r.text).toContain('排满');
  });
  it('floor 过滤掉所有已过时段 → 已过点 / hasFree=false', () => {
    const r = summarizeDay('今天', [slot('09:00', true), slot('10:00', true)], 23 * 60);
    expect(r.hasFree).toBe(false);
    expect(r.text).toContain('过点');
  });
});

describe('formatFactsBlock · 空维度省略', () => {
  it('全空 → 空串（调用方不注入）', () => {
    expect(formatFactsBlock(emptyFacts)).toBe('');
  });
  it('只含有的维度，缺的整行不出现', () => {
    const block = formatFactsBlock({
      ...emptyFacts,
      availabilityText: '今天排满了、没空；明天下午都有空',
      priceText: '60分钟 800泰铢',
    });
    expect(block).toContain('你的档期');
    expect(block).toContain('你的价位');
    expect(block).not.toContain('你做的项目');
    expect(block).not.toContain('上门');
  });
});

describe('checkFactsOverreach · ④ 越权时间承诺窄保险', () => {
  it('今日满 + 答应今晚来 → 拦（重生成）', () => {
    expect(checkFactsOverreach('今晚可以呀，来吧～', { todayFull: true }).ok).toBe(false);
    expect(checkFactsOverreach('今天没问题，等你哦', { todayFull: true }).ok).toBe(false);
  });
  it('今日满 + 只提明天 → 放行（不误伤）', () => {
    expect(checkFactsOverreach('今晚不行哎，明天可以来嘛～', { todayFull: true }).ok).toBe(true);
  });
  it('今日不满 + 答应今晚 → 放行（确实有空）', () => {
    expect(checkFactsOverreach('今晚可以呀，来吧', { todayFull: false }).ok).toBe(true);
  });
  it('普通寒暄"明天聊呀" → 放行', () => {
    expect(checkFactsOverreach('哈哈好呀明天聊', { todayFull: true }).ok).toBe(true);
  });
});
