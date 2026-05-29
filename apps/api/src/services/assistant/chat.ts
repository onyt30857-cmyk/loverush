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
import { type Database, users, assistantChatLog } from '@loverush/db';
import { loadEnv } from '../../env';
import { fireAndForget } from '../logger';
import { markActivatedAsync } from '../activation';
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
  /** A1 admin 会话回放 · 关联到 customer_assistant_sessions.id(若有) */
  sessionId?: string | null;
}

export interface ChatResult {
  /** 回复正文(已剥离 <choices> 标签) */
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
  /**
   * 快速回复候选 · 从 AI 输出的 <choices>A|B|C</choices> 提取
   * 前端在气泡下方渲染 chip 按钮 · 点击直接发送选项文字
   * 学:WhatsApp Business quick_replies / 微信小冰选项气泡 / Hinge AI 方向卡
   */
  quickReplies?: string[];
}

/**
 * 从 AI 输出中提取 <choices>A|B|C</choices> 标签
 * 返回:剥离后的纯文本 + 候选数组
 */
export function extractQuickReplies(text: string): {
  content: string;
  choices: string[];
} {
  const re = /<choices>([^<]+)<\/choices>/i;
  const m = text.match(re);
  if (!m) return { content: text, choices: [] };
  const raw = m[1] ?? '';
  const choices = raw
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 20)
    .slice(0, 4);
  const content = text.replace(re, '').trim();
  return { content, choices };
}

export async function chat(
  ctx: AssistantChatContext,
  args: ChatArgs,
): Promise<ChatResult> {
  // A1 admin · 计时
  const t0 = Date.now();

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

  // 8.5 无效账户治理 · 首次 chat 标记 activated_at(幂等)
  markActivatedAsync(ctx.db, args.userId);

  // 提取 <choices>A|B|C</choices> 作为 quick replies
  const { content: cleanContent, choices } = extractQuickReplies(filtered.content);

  // A1 admin 会话回放 · fire-and-forget 写入对话日志(不阻塞主链路)
  // 表 schema:packages/db/src/schema/assistant_chat_log.ts
  // 失败仅记 warn,不影响业务
  const latencyMs = Date.now() - t0;
  const turnIdx = (args.history ?? []).length;
  fireAndForget(
    ctx.db
      .insert(assistantChatLog)
      .values({
        userId: args.userId,
        sessionId: args.sessionId ?? null,
        turnIdx,
        userInput: redacted,
        userInputRaw: args.message !== redacted ? args.message : null,
        scenario: state.scenario,
        jokeLevel: state.jokeLevel,
        seriousMode: shouldUseSeriousMode(state) ? 1 : 0,
        locale,
        voiceVersion: null, // B1 上线后从 prompt version 表读
        fewshotIds: [], // B2 上线后填
        systemPrompt: system,
        memorySnippet: snippet || null,
        llmProvider: filtered.provider ?? null,
        llmModel: filtered.model ?? null,
        llmTier: 'T1',
        inputTokens: filtered.inputTokens ?? null,
        outputTokens: filtered.outputTokens ?? null,
        costUsdMicros: null, // 后续 D2 LLM 路由配置上线时算
        filterAttempts: filtered.attempts,
        filterFinalSoftScore: filtered.finalSoftScore,
        filterFinalHardHits: filtered.finalHardHits,
        llmRawOutput: filtered.rawOutput ?? null,
        finalContent: cleanContent,
        latencyMs,
      })
      .then(() => undefined),
    'assistant.chat_log_failed',
    { userId: args.userId },
  );

  return {
    content: cleanContent,
    scenario: state.scenario,
    jokeLevel: state.jokeLevel,
    seriousMode: shouldUseSeriousMode(state),
    filterAttempts: filtered.attempts,
    locale,
    quickReplies: choices.length > 0 ? choices : undefined,
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
