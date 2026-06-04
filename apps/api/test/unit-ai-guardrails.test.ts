/**
 * 单元测试 · AI_GUARDRAILS 护栏清单（M06b 运营透明单一真相源）
 *
 * 保证后台"内容与行为护栏"区渲染的清单完整、合法，且新护栏 key 与写红线日志的 flag 一致
 * （monitored=true 的 key 必须能在红线监控按该 flag 统计到）。
 */

import { describe, it, expect } from 'vitest';
import { AI_GUARDRAILS } from '../src/services/ai_alter';

const VALID_KINDS = ['hard_block', 'rewrite', 'output_check', 'grounding', 'prompt'];

describe('AI_GUARDRAILS · 护栏清单单一真相源', () => {
  it('包含两道新护栏，key 与写日志 flag 一致', () => {
    const keys = AI_GUARDRAILS.map((g) => g.key);
    expect(keys).toContain('facts_overreach'); // 与 ai_alter logGuardrailBlock flag 一致
    expect(keys).toContain('offsite_meetup'); // 与 ai_alter logGuardrailBlock flag 一致
  });

  it('两道新护栏标 monitored（运营可查拦截统计）', () => {
    expect(AI_GUARDRAILS.find((g) => g.key === 'facts_overreach')?.monitored).toBe(true);
    expect(AI_GUARDRAILS.find((g) => g.key === 'offsite_meetup')?.monitored).toBe(true);
  });

  it('覆盖核心红线（脱平台联系/支付/未成年/违法/编造记忆）', () => {
    const keys = AI_GUARDRAILS.map((g) => g.key);
    for (const k of ['contact_off_platform', 'payment_off_platform', 'minor', 'illegal', 'fake_memory']) {
      expect(keys).toContain(k);
    }
  });

  it('每条护栏字段完整且 kind 合法', () => {
    for (const g of AI_GUARDRAILS) {
      expect(g.label).toBeTruthy();
      expect(g.desc).toBeTruthy();
      expect(g.since).toBeTruthy();
      expect(VALID_KINDS).toContain(g.kind);
    }
  });

  it('key 唯一', () => {
    const keys = AI_GUARDRAILS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
