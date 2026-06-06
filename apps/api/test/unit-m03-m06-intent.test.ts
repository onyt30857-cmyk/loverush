/**
 * 单元测试 · M03→M06 客户来意传递(跨 AI 互通第一个消费侧)
 *
 * 让分身读到客户在 M03 的画像+事件,首次接触不再零信息。
 * 核心约束:只取对分身有用且不露馅的(调性/城市/下单意向),不取选人偏好(年龄/罩杯)。
 * mock db,不调 LLM。
 */
import { describe, it, expect } from 'vitest';
import { loadCustomerIntent } from '../src/services/ai_event';
import { buildSystemPrompt } from '../src/services/ai_alter';

function mockCtx(saved: unknown, events: unknown[] = []) {
  return {
    db: {
      query: {
        customerSavedMemory: { findFirst: async () => saved },
        customerAiEvent: { findMany: async () => events },
      },
    },
  } as never;
}

describe('loadCustomerIntent · M03→M06 来意组装', () => {
  it('有画像(调性+城市)→ 组装来意 + 含露馅防护(不准说破)', async () => {
    const s = await loadCustomerIntent(
      mockCtx({ facts: { service_style: ['活泼聊天', '成熟知性'], primary_focus: ['曼谷'] } }),
      'c1',
    );
    expect(s).toContain('活泼聊天');
    expect(s).toContain('曼谷');
    expect(s).toContain('诡异'); // "说破会让他觉得诡异" = 露馅防护
  });

  it('下单意向事件 → 体现"最近有过想约的意思"', async () => {
    const s = await loadCustomerIntent(
      mockCtx({ facts: {} }, [{ kind: 'booking_intent', source: 'm06', refTherapistId: null }]),
      'c1',
    );
    expect(s).toContain('想约');
  });

  it('绝不取选人偏好(年龄/罩杯)防露馅 —— 只取聊天调性', async () => {
    const s = await loadCustomerIntent(
      mockCtx({ facts: { age_pref: ['18-22'], bust_pref: ['D'], body_type: ['匀称'], service_style: ['活泼聊天'] } }),
      'c1',
    );
    expect(s).not.toContain('18-22');
    expect(s).not.toContain('D');
    expect(s).not.toContain('匀称');
    expect(s).toContain('活泼聊天');
  });

  it('无画像无事件 → 空串(不注入,行为零变化)', async () => {
    const s = await loadCustomerIntent(mockCtx(undefined, []), 'c1');
    expect(s).toBe('');
  });
});

describe('buildSystemPrompt · intentBlock 注入', () => {
  const base = {
    therapistDisplayName: '小雅',
    personality: {} as never,
    locale: 'zh',
    profileBlock: '',
    memoryBlock: '',
    factsBlock: '',
  };
  it('传 intentBlock → 含"你大概感觉到的他"段', () => {
    const sys = buildSystemPrompt({ ...base, intentBlock: '这位客户：喜欢活泼聊天。' });
    expect(sys).toContain('你大概感觉到的他');
    expect(sys).toContain('喜欢活泼聊天');
  });
  it('不传 → 不含来意段(零回归)', () => {
    expect(buildSystemPrompt(base)).not.toContain('你大概感觉到的他');
  });
});
