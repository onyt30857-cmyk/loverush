/**
 * @loverush/llm · LLM 网关
 *
 * 统一封装多 provider，业务侧只关心 tier（T1/T2/T3）。
 *
 * 使用示例：
 *   import { createLLMGateway, AnthropicProvider, OpenAIProvider } from '@loverush/llm';
 *
 *   const gateway = createLLMGateway({
 *     providers: {
 *       anthropic: new AnthropicProvider(env.ANTHROPIC_API_KEY),
 *       openai: new OpenAIProvider(env.OPENAI_API_KEY),
 *     },
 *     onMetric: (m) => metricsClient.report(m),
 *   });
 *
 *   const res = await gateway.complete({
 *     tier: 'T2',
 *     system: '你是 LoveRush 的贴心助理...',
 *     messages: [{ role: 'user', content: '你好' }],
 *     userId: 'u_123',
 *     traceId: 't_abc',
 *   });
 */

export * from './types';
export * from './gateway';
export * from './providers';
