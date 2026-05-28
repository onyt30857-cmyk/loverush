/**
 * 单元测试 · 反 AI slop filter
 *
 * 覆盖:
 * - 硬黑名单 15 条 (lintHard 应命中)
 * - 软规则 5 类 (lintSoft 应扣分)
 * - isAcceptable 综合判定
 */

import { describe, it, expect } from 'vitest';
import {
  lintHard,
  lintSoft,
  isAcceptable,
  HARD_BLACKLIST,
} from '../../src/services/assistant/filter';

describe('Unit · voice filter · 硬黑名单', () => {
  it('总规则数 ≥ 15', () => {
    expect(HARD_BLACKLIST.length).toBeGreaterThanOrEqual(15);
  });

  it('"作为一个 AI 助理" 命中', () => {
    const r = lintHard('作为一个 AI 助理,我建议你...');
    expect(r.shouldResample).toBe(true);
    expect(r.hits).toContain('self_ai_label_zh');
  });

  it('"As an AI" 命中', () => {
    const r = lintHard('As an AI language model, I can help.');
    expect(r.shouldResample).toBe(true);
  });

  it('"本 AI" 命中', () => {
    const r = lintHard('本 AI 觉得这个不错');
    expect(r.shouldResample).toBe(true);
    expect(r.hits).toContain('self_ai_ben');
  });

  it('"我永远在这里支持您" 命中', () => {
    const r = lintHard('我永远在这里支持您');
    expect(r.hits).toContain('rizz_companion');
  });

  it('"您说得太对了" 命中', () => {
    const r = lintHard('您说得太对了!');
    expect(r.hits).toContain('sycophancy_zh');
  });

  it('"Great question" 命中', () => {
    const r = lintHard('Great question! Let me think.');
    expect(r.hits).toContain('sycophancy_en');
  });

  it('"这是一个非常好的问题" 命中', () => {
    const r = lintHard('这是一个非常好的问题');
    expect(r.hits).toContain('great_question_zh');
  });

  it('"希望我的回答有帮助" 命中', () => {
    const r = lintHard('希望我的回答对您有帮助');
    expect(r.hits).toContain('hope_helps');
  });

  it('"还有什么可以帮您" 命中', () => {
    const r = lintHard('还有什么可以帮您的吗');
    expect(r.hits).toContain('anything_else');
  });

  it('开头 "您好" 命中', () => {
    const r = lintHard('您好,我帮你看一下');
    expect(r.hits).toContain('greeting_nin');
  });

  it('"请问您是否" 命中', () => {
    const r = lintHard('请问您是否需要推荐');
    expect(r.hits).toContain('qing_wen_nin');
  });

  it('"尊敬的客户" 命中', () => {
    const r = lintHard('尊敬的客户,您的订单已确认');
    expect(r.hits).toContain('esteemed_customer');
  });

  it('"非常抱歉给您带来不便" 命中', () => {
    const r = lintHard('非常抱歉给您带来不便');
    expect(r.hits).toContain('apology_inconvenience');
  });

  it('"非常深刻的洞见" 命中', () => {
    const r = lintHard('这是一个非常深刻的洞见');
    expect(r.hits).toContain('sycophancy_insight');
  });

  it('"完美的选择" 命中', () => {
    const r = lintHard('这是一个完美的选择');
    expect(r.hits).toContain('sycophancy_choice');
  });

  it('正常哥们腔不命中', () => {
    const r = lintHard('Lily 通拉本地 · 不爱聊天 · 4.8 分 · 要她?');
    expect(r.shouldResample).toBe(false);
    expect(r.hits).toEqual([]);
  });
});

describe('Unit · voice filter · 软规则', () => {
  it('长中文句被扣分', () => {
    const long = '这是一段非常长的中文句子里面包含了太多的修饰词和啰嗦的表达完全不符合好哥们的简洁风格也不像 LoveRush 的语气';
    const r = lintSoft(long, 'zh');
    expect(r.penalties.some((p) => p.label === 'long_sentence_zh')).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it('长英文句被扣分', () => {
    const long = 'This is an extremely long English sentence that contains too many filler words and unnecessary qualifiers which violates the voice rules.';
    const r = lintSoft(long, 'en');
    expect(r.penalties.some((p) => p.label === 'long_sentence_en')).toBe(true);
  });

  it('连续 emoji 被扣分', () => {
    const r = lintSoft('好的 🎉🎊✨');
    expect(r.penalties.some((p) => p.label === 'consecutive_emoji')).toBe(true);
  });

  it('中英混杂套话被扣分', () => {
    const r = lintSoft('Sure! 没问题哈');
    expect(r.penalties.some((p) => p.label === 'codeswitch_filler')).toBe(true);
  });

  it('markdown 列表被扣分', () => {
    const r = lintSoft('- 第一点\n- 第二点');
    expect(r.penalties.some((p) => p.label === 'markdown_list')).toBe(true);
  });
});

describe('Unit · isAcceptable · 综合判定', () => {
  it('正常 1 句通过', () => {
    const r = isAcceptable('行 · 那帮你约 Lily 周三晚 8 点');
    expect(r.ok).toBe(true);
  });

  it('硬命中不通过', () => {
    const r = isAcceptable('作为 AI 助理,我建议您选择 Lily');
    expect(r.ok).toBe(false);
    expect(r.hardHits.length).toBeGreaterThan(0);
  });
});
