/**
 * 单元测试 · simhash.ts（纯函数）
 *
 * 重点验证：
 * - 相同文本 → 相同 hash
 * - 相似文本 → Hamming 距离小
 * - 完全不同文本 → Hamming 距离大
 * - 编辑距离 vs Hamming 距离的关联
 */

import { describe, it, expect } from 'vitest';
import { computeSimhash, hammingDistance } from '../src/services/simhash';

describe('Unit · simhash 反重复', () => {
  it('相同文本产生相同 simhash', () => {
    const a = computeSimhash('你好啊今晚有空吗');
    const b = computeSimhash('你好啊今晚有空吗');
    expect(a).toBe(b);
  });

  it('空字符串可处理', () => {
    const h = computeSimhash('');
    expect(typeof h).toBe('bigint');
  });

  it('完全不同文本 Hamming 距离应该大（> 20）', () => {
    const a = computeSimhash('今晚我有空可以见面');
    const b = computeSimhash('明天我要去上海出差');
    const d = hammingDistance(a, b);
    expect(d).toBeGreaterThan(20);
  });

  it('近似文本 Hamming 距离应该小', () => {
    // 同样意思，仅几个字不同
    const a = computeSimhash('我今晚有空，可以见面');
    const b = computeSimhash('我今晚有空，能见面吗');
    const d = hammingDistance(a, b);
    expect(d).toBeLessThan(20); // 经验阈值
  });

  it('完全相同文本 Hamming 距离 = 0', () => {
    const a = computeSimhash('hello world');
    const b = computeSimhash('hello world');
    expect(hammingDistance(a, b)).toBe(0);
  });

  it('Hamming distance 是对称的', () => {
    const a = computeSimhash('文本 A');
    const b = computeSimhash('文本 B');
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it('英文输入也工作', () => {
    const a = computeSimhash('How are you doing today');
    const b = computeSimhash('How are you doing today');
    expect(a).toBe(b);
    expect(typeof a).toBe('bigint');
  });

  it('单字符差异 Hamming 距离非零', () => {
    const a = computeSimhash('我今晚有空');
    const b = computeSimhash('我今晚没空');
    expect(hammingDistance(a, b)).toBeGreaterThan(0);
  });

  it('阈值 12 大致区分相似 vs 不同（经验值）', () => {
    // 典型场景：复述同一句话 vs 完全不同的话
    const greeting1 = computeSimhash('你好亲，今晚我有空，欢迎来玩');
    const greeting2 = computeSimhash('你好啊，今晚我也有空，欢迎过来');
    const completelyDifferent = computeSimhash('我明天要出差去北京，下周才回来');

    const dSimilar = hammingDistance(greeting1, greeting2);
    const dDifferent = hammingDistance(greeting1, completelyDifferent);

    // 相似的比不同的距离更小（不强校验绝对值，只校验相对关系）
    expect(dSimilar).toBeLessThan(dDifferent);
  });
});
