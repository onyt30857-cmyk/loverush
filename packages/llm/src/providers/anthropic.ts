/**
 * Anthropic Claude provider
 *
 * Tier 映射：
 * - T1 → claude-sonnet-4-5（主对话）
 * - T2 → claude-haiku-4-5（高频轻量）
 * - T3 → claude-opus-4-7（复杂推理）
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMError } from '../types';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMTierValue,
} from '../types';

const MODELS: Record<LLMTierValue, string> = {
  T1: 'claude-sonnet-4-5',
  T2: 'claude-haiku-4-5',
  T3: 'claude-opus-4-7',
};

// 每 1M token 估算成本（USD）· 仅用于 metric，非精算
const COST_PER_MTOK: Record<LLMTierValue, { in: number; out: number }> = {
  T1: { in: 3, out: 15 },
  T2: { in: 0.8, out: 4 },
  T3: { in: 15, out: 75 },
};

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
    this.client = new Anthropic({ apiKey });
  }

  modelForTier(tier: LLMTierValue): string {
    return MODELS[tier];
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const model = this.modelForTier(req.tier);
    const start = Date.now();

    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
        system: req.system,
        messages: req.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      });

      const text = res.content
        .filter((b) => b.type === 'text')
        .map((b) => ('text' in b ? b.text : ''))
        .join('');

      const cost = COST_PER_MTOK[req.tier];
      const inTok = res.usage.input_tokens;
      const outTok = res.usage.output_tokens;

      return {
        id: res.id,
        content: text,
        finishReason: mapStopReason(res.stop_reason),
        usage: {
          inputTokens: inTok,
          outputTokens: outTok,
          totalTokens: inTok + outTok,
          costUsd: (inTok * cost.in + outTok * cost.out) / 1_000_000,
        },
        provider: this.name,
        model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw mapError(err, this.name);
    }
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = this.modelForTier(req.tier);

    try {
      const stream = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
        system: req.system,
        messages: req.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        stream: true,
      });

      let inTok = 0;
      let outTok = 0;

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { delta: event.delta.text, done: false };
        }
        if (event.type === 'message_delta' && event.usage) {
          outTok = event.usage.output_tokens;
        }
        if (event.type === 'message_start') {
          inTok = event.message.usage.input_tokens;
        }
      }

      const cost = COST_PER_MTOK[req.tier];
      yield {
        delta: '',
        done: true,
        usage: {
          inputTokens: inTok,
          outputTokens: outTok,
          totalTokens: inTok + outTok,
          costUsd: (inTok * cost.in + outTok * cost.out) / 1_000_000,
        },
      };
    } catch (err) {
      throw mapError(err, 'anthropic');
    }
  }
}

function mapStopReason(reason: string | null): LLMResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'stop';
  }
}

function mapError(err: unknown, provider: 'anthropic'): LLMError {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    const msg = (err as { message?: string }).message ?? 'anthropic error';
    if (status === 429) return new LLMError('RATE_LIMIT', msg, provider, true, err);
    if (status === 401 || status === 403) return new LLMError('AUTH_FAILED', msg, provider, false, err);
    if (status >= 500) return new LLMError('PROVIDER_ERROR', msg, provider, true, err);
    if (status === 400) return new LLMError('INVALID_REQUEST', msg, provider, false, err);
  }
  return new LLMError('PROVIDER_ERROR', String((err as Error)?.message ?? err), provider, true, err);
}
