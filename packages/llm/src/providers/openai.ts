/**
 * OpenAI provider（降级备用）
 *
 * Tier 映射：
 * - T1 → gpt-4o-mini
 * - T2 → gpt-4o-mini
 * - T3 → gpt-4o
 */

import OpenAI from 'openai';
import { LLMError } from '../types';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMTierValue,
} from '../types';

const MODELS: Record<LLMTierValue, string> = {
  T1: 'gpt-4o-mini',
  T2: 'gpt-4o-mini',
  T3: 'gpt-4o',
};

const COST_PER_MTOK: Record<LLMTierValue, { in: number; out: number }> = {
  T1: { in: 0.15, out: 0.6 },
  T2: { in: 0.15, out: 0.6 },
  T3: { in: 2.5, out: 10 },
};

export class OpenAIProvider implements LLMProvider {
  name = 'openai' as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('OPENAI_API_KEY missing');
    this.client = new OpenAI({ apiKey });
  }

  modelForTier(tier: LLMTierValue): string {
    return MODELS[tier];
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const model = this.modelForTier(req.tier);
    const start = Date.now();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam);
    }

    try {
      const res = await this.client.chat.completions.create({
        model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 1024,
      });

      const choice = res.choices[0];
      const text = choice?.message?.content ?? '';
      const cost = COST_PER_MTOK[req.tier];
      const inTok = res.usage?.prompt_tokens ?? 0;
      const outTok = res.usage?.completion_tokens ?? 0;

      return {
        id: res.id,
        content: text,
        finishReason: mapFinishReason(choice?.finish_reason),
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
      throw mapError(err);
    }
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = this.modelForTier(req.tier);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam);
    }

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 1024,
        stream: true,
        stream_options: { include_usage: true },
      });

      let inTok = 0;
      let outTok = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) yield { delta, done: false };
        if (chunk.usage) {
          inTok = chunk.usage.prompt_tokens;
          outTok = chunk.usage.completion_tokens;
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
      throw mapError(err);
    }
  }
}

function mapFinishReason(reason: string | null | undefined): LLMResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'stop';
  }
}

function mapError(err: unknown): LLMError {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    const msg = (err as { message?: string }).message ?? 'openai error';
    if (status === 429) return new LLMError('RATE_LIMIT', msg, 'openai', true, err);
    if (status === 401 || status === 403) return new LLMError('AUTH_FAILED', msg, 'openai', false, err);
    if (status >= 500) return new LLMError('PROVIDER_ERROR', msg, 'openai', true, err);
    if (status === 400) return new LLMError('INVALID_REQUEST', msg, 'openai', false, err);
  }
  return new LLMError('PROVIDER_ERROR', String((err as Error)?.message ?? err), 'openai', true, err);
}
