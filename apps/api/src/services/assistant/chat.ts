/**
 * Chat 入口 · M03
 *
 * 把 voice + state machine + memory + filter 串成一条主链。
 *
 * 流程:
 *   1. redact 客户输入(服务端兜底)
 *   2. detectState 推断场景 + 玩笑度
 *   3. readSaved 拉 L1+L2 snippet
 *   4. buildSystemPrompt 装配 prompt
 *   5. generateWithFilter 跑 LLM + 反 slop(最多 3 次重 sample)
 *   6. fireAndForget extractAndPersist 偏好提取(规则同步 + LLM 异步)
 *   7. 返回 reply + meta(场景 / 是否进入严肃应对档位)
 */

import {
  AnthropicProvider,
  GeminiProvider,
  OpenAIProvider,
  createLLMGateway,
  type LLMGateway,
  type LLMMessage,
} from '@loverush/llm';
import { eq } from 'drizzle-orm';
import { type Database, users } from '@loverush/db';
import { loadEnv } from '../../env';
import { fireAndForget } from '../logger';
import { detectState, shouldUseSeriousMode } from './state-machine';
import {
  buildSystemPrompt,
  normalizeLocale,
  shouldReinjectSystem,
  type AssistantLocale,
} from './voice';
import { readAllReference, readSaved, compactSavedToSnippet } from './memory';
import { generateWithFilter } from './filter';
import { extractAndPersist } from './extractor';
import { redact } from './redact';

export interface AssistantChatContext {
  db: Database;
}

let cachedGateway: LLMGateway | null = null;
export function getGateway(): LLMGateway {
  if (cachedGateway) return cachedGateway;
  const env = loadEnv();
  cachedGateway = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    },
  });
  return cachedGateway;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatArgs {
  userId: string;
  message: string;
  history?: ChatTurn[];
  /** 强制覆盖 locale(否则用 users.locale) */
  localeOverride?: AssistantLocale;
}

export interface ChatResult {
  /** 回复正文 */
  content: string;
  /** 推断的场景(供前端显示提示) */
  scenario: string;
  jokeLevel: 0 | 1 | 2 | 3;
  /** 是否进入"严肃应对"档位(玩笑全关 + 短句正经口气) */
  seriousMode: boolean;
  /** 反 slop 防线:重 sample 次数 */
  filterAttempts: number;
  /** locale */
  locale: AssistantLocale;
}

export async function chat(
  ctx: AssistantChatContext,
  args: ChatArgs,
): Promise<ChatResult> {
  // 1. 兜底脱敏
  const redacted = redact(args.message).cleaned;

  // 2. 拉用户 locale
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, args.userId) });
  const locale = args.localeOverride ?? normalizeLocale(u?.locale);

  // 3. 检测状态(用最近 3 轮客户消息)
  const recentUserMsgs = (args.history ?? [])
    .filter((h) => h.role === 'user')
    .map((h) => h.content)
    .slice(-2);
  const state = detectState([redacted, ...recentUserMsgs.reverse()]);

  // 4. 拉画像 snippet
  const saved = await readSaved(ctx, args.userId);
  const ref = await readAllReference(ctx, args.userId, 5);
  const refLines = [
    ...ref.relation.slice(0, 3).map((r) => `[关系] ${r.content}`),
    ...ref.rotating.slice(0, 2).map((r) => `[近期] ${r.content}`),
    ...ref.diff.slice(0, 2).map((r) => `[趋势] ${r.content}`),
  ].join('\n');
  const savedSnippet = compactSavedToSnippet(saved);
  const snippet = [savedSnippet, refLines].filter(Boolean).join('\n');

  // 5. 装 system
  const system = buildSystemPrompt({
    locale,
    scenario: state.scenario,
    jokeLevel: state.jokeLevel,
    profileSnippet: snippet || undefined,
  });

  // 6. 构造 messages · 长对话每 5 轮回灌
  const trimmed = (args.history ?? []).slice(-10);
  const messages: LLMMessage[] = trimmed.map((h) => ({ role: h.role, content: h.content }));
  if (shouldReinjectSystem(trimmed.length)) {
    messages.unshift({ role: 'user', content: '【回灌锚点】请保持你的人设和反 slop 规则' });
  }
  messages.push({ role: 'user', content: redacted });

  // 7. 反 slop 过滤 + 自动重 sample
  const family = locale === 'en' ? 'en' : 'zh';
  const filtered = await generateWithFilter({
    gateway: getGateway(),
    tier: 'T1',
    system,
    messages,
    temperature: 0.7,
    maxTokens: 400,
    userId: args.userId,
    tag: 'assistant.chat',
    locale: family,
    maxAttempts: 3,
  });

  // 8. fire-and-forget 偏好提取(规则同步 / LLM 异步)
  fireAndForget(
    extractAndPersist(ctx, getGateway(), {
      userId: args.userId,
      text: redacted,
      intent: 'rotating',
    }).then(() => undefined),
    'assistant.extract_failed',
    { userId: args.userId },
  );

  return {
    content: filtered.content,
    scenario: state.scenario,
    jokeLevel: state.jokeLevel,
    seriousMode: shouldUseSeriousMode(state),
    filterAttempts: filtered.attempts,
    locale,
  };
}

/**
 * "下次帮我推 3 个" · 收藏式延迟决策
 *
 * 实现:写一条 L3 rotating · importance 8(高优,7 天内触发推荐)
 */
export async function recall3(
  ctx: AssistantChatContext,
  args: { userId: string; intent?: string },
): Promise<{ ok: true; note: string }> {
  const note = args.intent ? `客户预约延迟决策:${args.intent}` : '客户预约延迟决策:下次帮我推 3 个';
  const { writeRotating } = await import('./memory');
  await writeRotating(ctx, args.userId, {
    content: note,
    entities: ['recall_3_request'],
    importance: 8,
  });
  return { ok: true, note };
}
