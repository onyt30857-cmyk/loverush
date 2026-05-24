/**
 * Google Gemini provider（T2 备用）
 *
 * Tier 映射：
 * - T1 → gemini-1.5-pro
 * - T2 → gemini-1.5-flash
 * - T3 → gemini-1.5-pro
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMError } from '../types';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMTierValue,
} from '../types';

const MODELS: Record<LLMTierValue, string> = {
  T1: 'gemini-1.5-pro',
  T2: 'gemini-1.5-flash',
  T3: 'gemini-1.5-pro',
};

const COST_PER_MTOK: Record<LLMTierValue, { in: number; out: number }> = {
  T1: { in: 1.25, out: 5 },
  T2: { in: 0.075, out: 0.3 },
  T3: { in: 1.25, out: 5 },
};

export class GeminiProvider implements LLMProvider {
  name = 'gemini' as const;
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('GEMINI_API_KEY missing');
    this.client = new GoogleGenerativeAI(apiKey);
  }

  modelForTier(tier: LLMTierValue): string {
    return MODELS[tier];
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const modelName = this.modelForTier(req.tier);
    const start = Date.now();

    try {
      const model = this.client.getGenerativeModel({
        model: modelName,
        systemInstruction: req.system,
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 1024,
        },
      });

      const contents = req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const res = await model.generateContent({ contents });
      const text = res.response.text();
      const meta = res.response.usageMetadata;
      const cost = COST_PER_MTOK[req.tier];
      const inTok = meta?.promptTokenCount ?? 0;
      const outTok = meta?.candidatesTokenCount ?? 0;

      return {
        id: `gemini_${Date.now()}`,
        content: text,
        finishReason: 'stop',
        usage: {
          inputTokens: inTok,
          outputTokens: outTok,
          totalTokens: inTok + outTok,
          costUsd: (inTok * cost.in + outTok * cost.out) / 1_000_000,
        },
        provider: this.name,
        model: modelName,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw mapError(err);
    }
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const modelName = this.modelForTier(req.tier);

    try {
      const model = this.client.getGenerativeModel({
        model: modelName,
        systemInstruction: req.system,
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 1024,
        },
      });

      const contents = req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const result = await model.generateContentStream({ contents });
      let inTok = 0;
      let outTok = 0;

      for await (const chunk of result.stream) {
        const delta = chunk.text();
        if (delta) yield { delta, done: false };
        if (chunk.usageMetadata) {
          inTok = chunk.usageMetadata.promptTokenCount ?? inTok;
          outTok = chunk.usageMetadata.candidatesTokenCount ?? outTok;
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

function mapError(err: unknown): LLMError {
  const msg = String((err as Error)?.message ?? err);
  if (msg.includes('429') || msg.includes('quota')) {
    return new LLMError('RATE_LIMIT', msg, 'gemini', true, err);
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
    return new LLMError('AUTH_FAILED', msg, 'gemini', false, err);
  }
  return new LLMError('PROVIDER_ERROR', msg, 'gemini', true, err);
}
