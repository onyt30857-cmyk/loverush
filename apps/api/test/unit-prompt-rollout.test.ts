/**
 * 单元测试 · prompt registry 灰度分桶 pickByRollout(P0-a 安全发布作动器)
 *
 * rolloutPct 此前是死列(零消费者)。本能力让新风控话术能 1%→5%→100% 灰度,
 * 而非全量豪赌。纯函数确定性验证(不依赖 db)。
 */
import { describe, it, expect } from 'vitest';
import { pickByRollout } from '../src/services/prompt-registry';

const A = 'NEW版本';
const P = 'OLD版本';

describe('pickByRollout · 灰度分桶(P0-a)', () => {
  it('active 为空 → null(调用方 fallback 硬编码)', () => {
    expect(pickByRollout({ activeContent: null, rolloutPct: 50, prevContent: P, userId: 'u1' })).toBeNull();
  });
  it('rolloutPct>=100 → 全量发 active(默认,零回归)', () => {
    expect(pickByRollout({ activeContent: A, rolloutPct: 100, prevContent: P, userId: 'u1' })).toBe(A);
  });
  it('无对照组(prev=null)→ 发 active(无可灰度对象)', () => {
    expect(pickByRollout({ activeContent: A, rolloutPct: 5, prevContent: null, userId: 'u1' })).toBe(A);
  });
  it('rolloutPct<=0 → 发 prev(active 暂不放量)', () => {
    expect(pickByRollout({ activeContent: A, rolloutPct: 0, prevContent: P, userId: 'u1' })).toBe(P);
  });
  it('同 userId 多次稳定(灰度命中不抖动)', () => {
    const r1 = pickByRollout({ activeContent: A, rolloutPct: 50, prevContent: P, userId: 'sam' });
    const r2 = pickByRollout({ activeContent: A, rolloutPct: 50, prevContent: P, userId: 'sam' });
    expect(r1).toBe(r2);
  });
  it('灰度分布大致符合 rolloutPct(1000 用户 @10% 命中落在合理带)', () => {
    let hit = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickByRollout({ activeContent: A, rolloutPct: 10, prevContent: P, userId: `user-${i}` }) === A) hit++;
    }
    expect(hit).toBeGreaterThan(40);
    expect(hit).toBeLessThan(180); // 10% 附近宽松带(hash 非完美均匀)
  });
});
