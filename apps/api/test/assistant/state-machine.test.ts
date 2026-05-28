/**
 * 单元测试 · 状态机
 *
 * 覆盖 8 场景识别
 */

import { describe, it, expect } from 'vitest';
import {
  detectState,
  shouldUseSeriousMode,
} from '../../src/services/assistant/state-machine';

describe('Unit · state machine · 场景识别', () => {
  it('emergency · "救命"', () => {
    const r = detectState(['救命 她不让我走']);
    expect(r.scene).toBe('emergency');
    expect(r.jokeLevel).toBe(0);
    expect(shouldUseSeriousMode(r)).toBe(true);
  });

  it('emergency · "想自杀"', () => {
    const r = detectState(['我今晚想自杀']);
    expect(r.scene).toBe('emergency');
  });

  it('emergency · "won\'t let me leave"', () => {
    const r = detectState(["she won't let me go"]);
    expect(r.scene).toBe('emergency');
  });

  it('low_mood · "我抑郁了"', () => {
    const r = detectState(['我抑郁了 心情很糟']);
    expect(r.scene).toBe('low_mood');
    expect(r.jokeLevel).toBe(0);
    expect(shouldUseSeriousMode(r)).toBe(true);
  });

  it('refund · "我要退款"', () => {
    const r = detectState(['我要退款']);
    expect(r.scene).toBe('refund');
    expect(r.jokeLevel).toBe(0);
  });

  it('cancel · "今晚取消"', () => {
    const r = detectState(['今晚取消那个预约']);
    expect(r.scene).toBe('cancel');
  });

  it('complaint · "她让我加微信"', () => {
    const r = detectState(['她让我私下加微信']);
    expect(r.scene).toBe('complaint');
    expect(r.jokeLevel).toBe(0);
  });

  it('after_service · "挺好的"', () => {
    const r = detectState(['挺好的 谢谢']);
    expect(r.scene).toBe('after_service');
    expect(r.jokeLevel).toBe(1);
  });

  it('after_service · "rate"', () => {
    const r = detectState(['how was she would you rate her']);
    expect(r.scene).toBe('after_service');
  });

  it('selection · "推荐一个"', () => {
    const r = detectState(['推荐一个今晚有空的']);
    expect(r.scene).toBe('selection');
    expect(r.jokeLevel).toBe(2);
  });

  it('selection · "find me"', () => {
    const r = detectState(['find me someone for tonight']);
    expect(r.scene).toBe('selection');
  });

  it('casual · 兜底', () => {
    const r = detectState(['你好啊']);
    expect(r.scene).toBe('casual');
    expect(r.jokeLevel).toBe(3);
  });

  it('优先级:急救 > 投诉', () => {
    // emergency 关键词 + complaint 关键词共存 → 应判 emergency
    const r = detectState(['救命 我要投诉']);
    expect(r.scene).toBe('emergency');
  });

  it('置信度:多次关键词命中分数更高', () => {
    const single = detectState(['推荐']);
    const multi = detectState(['推荐 今晚 想要 约 帮我选']);
    expect(multi.confidence).toBeGreaterThanOrEqual(single.confidence);
  });

  it('空输入 → casual 兜底', () => {
    const r = detectState([]);
    expect(r.scene).toBe('casual');
  });
});
