/**
 * LLM 网关统一类型
 *
 * 对所有 provider（Claude / OpenAI / Gemini）封装成统一 IO，
 * 上层业务只关心 tier（T1/T2/T3），不关心 model 名字。
 */

export const LLMTier = {
  T1: 'T1', // 主对话（高质量）· Sonnet 主 / GPT-4o-mini 备
  T2: 'T2', // 高频轻量任务 · Haiku 主 / Gemini Flash 备
  T3: 'T3', // 复杂推理 · Opus 主 / GPT-4o 备
} as const;

export type LLMTierValue = (typeof LLMTier)[keyof typeof LLMTier];

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMRequest {
  tier: LLMTierValue;
  messages: LLMMessage[];
  /** 系统提示词（独立字段，便于 Claude 用 system 参数） */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** JSON Schema 约束输出（部分 provider 支持） */
  responseSchema?: Record<string, unknown>;
  /** 用户/会话标识（用于追踪 + 限流） */
  traceId?: string;
  userId?: string;
  /** 业务标签（cost 归因） */
  tag?: string;
  /** 流式输出 */
  stream?: boolean;
  /** 强制使用指定 provider（绕过路由） */
  forceProvider?: LLMProviderName;
  /** 已尝试过的 provider（用于降级链跳过） */
  triedProviders?: LLMProviderName[];
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 估算成本（USD） */
  costUsd?: number;
}

export interface LLMResponse {
  id: string;
  content: string;
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_use' | 'error';
  usage: LLMUsage;
  provider: LLMProviderName;
  model: string;
  latencyMs: number;
  /** 如果发生了降级，记录降级链 */
  fallbackChain?: LLMProviderName[];
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  usage?: LLMUsage;
}

export type LLMProviderName = 'anthropic' | 'openai' | 'gemini';

export interface LLMProvider {
  name: LLMProviderName;
  modelForTier(tier: LLMTierValue): string;
  call(req: LLMRequest): Promise<LLMResponse>;
  stream?(req: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

export class LLMError extends Error {
  constructor(
    public code:
      | 'RATE_LIMIT'
      | 'TIMEOUT'
      | 'AUTH_FAILED'
      | 'CONTENT_FILTER'
      | 'PROVIDER_ERROR'
      | 'INVALID_REQUEST'
      | 'ALL_PROVIDERS_FAILED',
    message: string,
    public provider?: LLMProviderName,
    public retryable: boolean = false,
    public override cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** Tier → Provider 优先级（前面失败自动降级到后面） */
export const TIER_ROUTE: Record<LLMTierValue, LLMProviderName[]> = {
  T1: ['anthropic', 'openai'],
  T2: ['anthropic', 'gemini'],
  T3: ['anthropic', 'openai'],
};
