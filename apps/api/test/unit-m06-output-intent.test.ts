/**
 * 单元测试 · M06 分身脏输出拦截(fix1)+ 下单意图识别(fix3b)(2026-06-06)
 *
 * 双对话审计真根因(生产铁证):
 *  - Mei×sam 第106/125/133:礼物道谢路径发出空串 ""、"---" 给客户 → validateOutput 漏拦空/纯符号。
 *  - 小雅×sam 第42:"为什么下不了单?" → detectBookingIntent 漏判 → 被陪聊付费墙拦死。
 * 本测试纯函数确定性验证(不调 LLM、不依赖 DB)。
 */
import { describe, it, expect } from 'vitest';
import { validateOutput, buildSystemPrompt } from '../src/services/ai_alter';
import { detectBookingIntent } from '../src/services/orderOffer';

describe('validateOutput · 脏输出拦截(fix1)', () => {
  it('空串 / 纯空白 → 拦', () => {
    expect(validateOutput('').ok).toBe(false);
    expect(validateOutput('   ').ok).toBe(false);
    expect(validateOutput('\n\n  ').ok).toBe(false);
  });
  it('纯标点残留(--- / 。。。 / ~~~ / …)→ 拦', () => {
    expect(validateOutput('---').ok).toBe(false);
    expect(validateOutput('。。。').ok).toBe(false);
    expect(validateOutput('~~~').ok).toBe(false);
    expect(validateOutput('…').ok).toBe(false);
    expect(validateOutput('！！！').ok).toBe(false);
  });
  it('正常道谢 / 承诺 → 放行', () => {
    expect(validateOutput('哇你真的送啦~好开心呀').ok).toBe(true);
    expect(validateOutput('明天晚上8点可以哦，给你留着').ok).toBe(true);
  });
});

describe('detectBookingIntent · 下单意图(fix3b)', () => {
  it('"为什么下不了单?" → true(此前漏判致弹陪聊墙)', () => {
    expect(detectBookingIntent('为什么下不了单?')).toBe(true);
  });
  it('"那你给我一个下单入口吧" → true', () => {
    expect(detectBookingIntent('那你给我一个下单入口吧')).toBe(true);
  });
  it('下单 / 约你 / 怎么付费 / 支付 → true', () => {
    expect(detectBookingIntent('我想下单')).toBe(true);
    expect(detectBookingIntent('怎么付费呀')).toBe(true);
    expect(detectBookingIntent('在哪里支付')).toBe(true);
  });
  it('纯闲聊 → false(不误触发下单卡)', () => {
    expect(detectBookingIntent('随便聊聊')).toBe(false);
    expect(detectBookingIntent('你今天累吗')).toBe(false);
    expect(detectBookingIntent(undefined)).toBe(false);
  });
});

describe('buildSystemPrompt · 记忆诚实负约束(fix4a)', () => {
  const sys = buildSystemPrompt({
    therapistDisplayName: '小雅',
    personality: {} as never,
    locale: 'zh',
    profileBlock: '',
    memoryBlock: '',
    factsBlock: '',
  });
  it('prompt 含"记忆要诚实"规则', () => {
    expect(sys).toContain('记忆要诚实');
  });
  it('禁止硬否认 / 反咬记错 / 甩锅平台(治小雅第33/36/45)', () => {
    expect(sys).toContain('绝不硬否认');
    expect(sys).toContain('甩'); // 甩锅给"平台问题/那边系统"
  });
});
