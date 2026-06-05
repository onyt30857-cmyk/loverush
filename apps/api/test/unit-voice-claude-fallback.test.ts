/**
 * 单元测试 · M03 语音助理 provider 兜底(2026-06-06 修"每条都卡")
 *
 * 根因:forceProvider:'anthropic' 无兜底,成人/性化采购请求 anthropic 拒答→返非 JSON→解析失败→每条兜底。
 * 修:解析失败时自动换 openai 重试。本测试用 mock gateway 确定性验证(不调真 LLM、不依赖 DB)。
 */
import { describe, it, expect } from 'vitest';
import { processVoiceTurn } from '../src/services/assistant/voice-claude';

function mockGateway(byProvider: Record<string, string>) {
  const calls: string[] = [];
  const gateway = {
    async complete(req: { forceProvider?: string }) {
      const provider = req.forceProvider ?? 'anthropic';
      calls.push(provider);
      return {
        content: byProvider[provider] ?? '',
        provider,
        model: `${provider}-mock`,
        usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.0001 },
      };
    },
  };
  return { gateway, calls };
}
const REFUSAL = "I'm sorry, but I can't help with that request.";
const VALID = '{"reply_text":"好嘞,我帮你看看在线的~","recommend_intent":{"online":true}}';

describe('M03 语音助理 · provider 兜底', () => {
  it('anthropic 拒答(非 JSON)→ 自动换 openai 重试 → 出真回复(非兜底)', async () => {
    const { gateway, calls } = mockGateway({ anthropic: REFUSAL, openai: VALID });
    const r = await processVoiceTurn({ gateway: gateway as never, text: '帮我找符合的', history: [], userId: 'u1' });
    expect(r.degraded).toBeFalsy();
    expect(r.replyText).toContain('帮你看看');
    expect(r.provider).toBe('openai');
    expect(r.recommendIntent).toBeTruthy();
    expect(calls).toEqual(['anthropic', 'openai']); // 先试 anthropic 失败再切 openai
  });

  it('anthropic + openai 都拒答 → degraded=true + 安全兜底(绝不露原始结构)', async () => {
    const { gateway, calls } = mockGateway({ anthropic: REFUSAL, openai: REFUSAL });
    const r = await processVoiceTurn({ gateway: gateway as never, text: '帮我找符合的', history: [], userId: 'u1' });
    expect(r.degraded).toBe(true);
    expect(r.replyText).toBe('我这边卡了一下 · 你再说一遍?');
    expect(calls).toEqual(['anthropic', 'openai']);
  });

  it('anthropic 首次就出合法 JSON → 不重试 · provider=anthropic', async () => {
    const { gateway, calls } = mockGateway({ anthropic: VALID });
    const r = await processVoiceTurn({ gateway: gateway as never, text: '随便聊聊', history: [], userId: 'u1' });
    expect(r.degraded).toBeFalsy();
    expect(r.provider).toBe('anthropic');
    expect(calls).toEqual(['anthropic']); // 只调一次
  });

  it('anthropic 在 JSON 前带前导话(非纯 JSON)→ 仍能抠出 · 不算失败', async () => {
    const { gateway, calls } = mockGateway({ anthropic: `好的~\n${VALID}` });
    const r = await processVoiceTurn({ gateway: gateway as never, text: 'hi', history: [], userId: 'u1' });
    expect(r.degraded).toBeFalsy();
    expect(r.replyText).toContain('帮你看看');
    expect(calls).toEqual(['anthropic']);
  });
});
