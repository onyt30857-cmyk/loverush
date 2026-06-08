/**
 * 单元测试 · passesVoiceGate（分身回复语音化的短句门 + 30% 抽签纯函数部分）
 * 真克隆门（查库）不在此测，靠接入后生产验证覆盖。
 */
import { describe, it, expect } from 'vitest';
import { passesVoiceGate } from '../src/services/ai_alter';

const short = '今晚早点睡，我陪着你。'; // 11 可见字符，<60

describe('passesVoiceGate · 短句门', () => {
  it('空文本 → false', () => {
    expect(passesVoiceGate('', () => 0)).toBe(false);
    expect(passesVoiceGate('   ', () => 0)).toBe(false);
  });
  it('超长(>60 可见字符) → false（即使抽签命中）', () => {
    const longText = '啊'.repeat(61);
    expect(passesVoiceGate(longText, () => 0)).toBe(false);
  });
  it('恰好 60 可见字符 → 不被长度门拦（仍按抽签命中）', () => {
    const exactly60 = '啊'.repeat(60);
    expect(passesVoiceGate(exactly60, () => 0)).toBe(true);
  });
  it('含 URL → false（即使抽签命中）', () => {
    expect(passesVoiceGate('看这个 https://x.com 哦', () => 0)).toBe(false);
    expect(passesVoiceGate('戳 http://a.cn', () => 0)).toBe(false);
  });
  it('长度按去空白可见字符算（含换行的短多段仍可过长度门）', () => {
    expect(passesVoiceGate('在呢\n\n想你了', () => 0)).toBe(true); // 5 可见字符
  });
});

describe('passesVoiceGate · 30% 抽签边界', () => {
  it('rand < 0.3 → true', () => {
    expect(passesVoiceGate(short, () => 0.29)).toBe(true);
    expect(passesVoiceGate(short, () => 0)).toBe(true);
  });
  it('rand >= 0.3 → false', () => {
    expect(passesVoiceGate(short, () => 0.3)).toBe(false);
    expect(passesVoiceGate(short, () => 0.99)).toBe(false);
  });
});
