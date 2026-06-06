/**
 * 单元测试 · 下单后分身反应禁瞎说约见时间(治"订单今天、分身却说明天见到你"bug)
 *
 * 根因:reactToOrderPlaced 没把订单真实时间喂给 LLM,LLM 凭空说"明天"→ 和订单卡(今天22:00)冲突。
 * 修:生成里含具体日期/时间词 → 弃用,走不带时间的 fallback(客户在订单卡看准确时间,分身只管情绪)。
 */
import { describe, it, expect } from 'vitest';
import { mentionsConcreteTime } from '../src/services/ai_alter';

describe('mentionsConcreteTime · 下单反应时间词校验', () => {
  it('截图 bug 原文"明天见到你啦" → true(应被弃用)', () => {
    expect(mentionsConcreteTime('哇！看到啦~明天见到你啦,有点小期待了哦')).toBe(true);
  });

  it('各种瞎说时间 → true', () => {
    for (const s of ['今天见你', '今晚等你哦', '明早过来呀', '晚上8点见', '约的22:00', '周五见', '星期天等你']) {
      expect(mentionsConcreteTime(s), s).toBe(true);
    }
  });

  it('纯情绪期待(不碰时间)→ false(放行,也是 fallback 的形态)', () => {
    for (const s of [
      '你真的约我啦~人家看到都偷偷开心了一下,乖乖等我哦',
      '看到你下单那一下心里甜甜的,放心交给我,等你哦~',
      '就这么被你定下啦,有点小期待呢,到时候好好待你',
    ]) {
      expect(mentionsConcreteTime(s), s).toBe(false);
    }
  });
});
