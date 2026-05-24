/**
 * LLM 网关（核心入口）
 *
 * 职责：
 * 1. 路由：按 tier 选定 provider 优先级链
 * 2. 容错：429 / 5xx / 超时 自动降级到下一个 provider
 * 3. 计数：上报 token + cost + latency
 * 4. 流式：支持 SSE 透传
 *
 * 业务侧使用：
 *   const gateway = createLLMGateway({ ... });
 *   const res = await gateway.complete({ tier: 'T2', messages: [...] });
 */

import { LLMError, TIER_ROUTE } from './types';
import type {
  LLMProvider,
  LLMProviderName,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
} from './types';

export interface LLMGatewayOptions {
  providers: Partial<Record<LLMProviderName, LLMProvider>>;
  /** 单 provider 调用超时（ms），默认 30s */
  timeoutMs?: number;
  /** 自定义 tier 路由（覆盖默认 TIER_ROUTE） */
  routeOverride?: Partial<typeof TIER_ROUTE>;
  /** 计数回调（用于 metrics 上报） */
  onMetric?: (m: LLMMetric) => void;
}

export interface LLMMetric {
  tier: string;
  provider: LLMProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  traceId?: string;
  userId?: string;
  tag?: string;
}

export interface LLMGateway {
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream(req: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

export function createLLMGateway(opts: LLMGatewayOptions): LLMGateway {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const route = { ...TIER_ROUTE, ...opts.routeOverride };

  function resolveProviders(req: LLMRequest): LLMProvider[] {
    const tried = new Set(req.triedProviders ?? []);
    const names = req.forceProvider ? [req.forceProvider] : route[req.tier];
    const list: LLMProvider[] = [];
    for (const name of names) {
      if (tried.has(name)) continue;
      const p = opts.providers[name];
      if (p) list.push(p);
    }
    if (list.length === 0) {
      throw new LLMError(
        'ALL_PROVIDERS_FAILED',
        `No available provider for tier ${req.tier}`,
        undefined,
        false,
      );
    }
    return list;
  }

  async function callWithTimeout(p: LLMProvider, req: LLMRequest): Promise<LLMResponse> {
    return await Promise.race([
      p.call(req),
      new Promise<LLMResponse>((_, reject) =>
        setTimeout(
          () => reject(new LLMError('TIMEOUT', `${p.name} timeout`, p.name, true)),
          timeoutMs,
        ),
      ),
    ]);
  }

  return {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const providers = resolveProviders(req);
      const fallbackChain: LLMProviderName[] = [];
      let lastErr: LLMError | undefined;

      for (const p of providers) {
        try {
          const res = await callWithTimeout(p, req);
          opts.onMetric?.({
            tier: req.tier,
            provider: res.provider,
            model: res.model,
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            costUsd: res.usage.costUsd ?? 0,
            latencyMs: res.latencyMs,
            success: true,
            traceId: req.traceId,
            userId: req.userId,
            tag: req.tag,
          });
          if (fallbackChain.length) res.fallbackChain = fallbackChain;
          return res;
        } catch (err) {
          const llmErr = err instanceof LLMError ? err : new LLMError('PROVIDER_ERROR', String(err), p.name, true, err);
          lastErr = llmErr;
          fallbackChain.push(p.name);

          opts.onMetric?.({
            tier: req.tier,
            provider: p.name,
            model: p.modelForTier(req.tier),
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: 0,
            success: false,
            errorCode: llmErr.code,
            traceId: req.traceId,
            userId: req.userId,
            tag: req.tag,
          });

          // 不可重试 → 直接抛
          if (!llmErr.retryable) throw llmErr;
          // 可重试 → 继续下一个 provider
        }
      }

      throw new LLMError(
        'ALL_PROVIDERS_FAILED',
        `All providers failed for tier ${req.tier}: ${lastErr?.message}`,
        undefined,
        false,
        lastErr,
      );
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
      const providers = resolveProviders(req);
      let lastErr: LLMError | undefined;

      for (const p of providers) {
        if (!p.stream) continue;
        try {
          for await (const chunk of p.stream({ ...req, stream: true })) {
            yield chunk;
            if (chunk.done && chunk.usage) {
              opts.onMetric?.({
                tier: req.tier,
                provider: p.name,
                model: p.modelForTier(req.tier),
                inputTokens: chunk.usage.inputTokens,
                outputTokens: chunk.usage.outputTokens,
                costUsd: chunk.usage.costUsd ?? 0,
                latencyMs: 0,
                success: true,
                traceId: req.traceId,
                userId: req.userId,
                tag: req.tag,
              });
            }
          }
          return;
        } catch (err) {
          const llmErr = err instanceof LLMError ? err : new LLMError('PROVIDER_ERROR', String(err), p.name, true, err);
          lastErr = llmErr;
          if (!llmErr.retryable) throw llmErr;
        }
      }

      throw new LLMError(
        'ALL_PROVIDERS_FAILED',
        `All stream providers failed for tier ${req.tier}: ${lastErr?.message}`,
        undefined,
        false,
        lastErr,
      );
    },
  };
}
