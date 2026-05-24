/**
 * AI 助理服务 · M03
 *
 * 三个核心动作：
 * 1. greet(customerId)：进入助理页时主动打招呼（有温度、引用近期上下文）
 * 2. chat(customerId, message)：连续对话，支持偏好学习副作用
 * 3. learn(customerId, message)：从用户消息抽取偏好 → 写 customer_master_preferences
 *
 * 注：v5 政策 · 客户端 ZERO AI 标识，所有输出都按"贴心助理"语气直接说，不带 "AI"/"bot" 字样。
 */

import { eq } from 'drizzle-orm';
import {
  Database,
  customerAssistantProfile,
  customerMasterPreferences,
  customerSessionPreferences,
  users,
} from '@loverush/db';
import {
  createLLMGateway,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type LLMGateway,
  type LLMMessage,
} from '@loverush/llm';
import { loadEnv } from '../env';
import { fireAndForget } from './logger';

export interface AssistantContext {
  db: Database;
}

let cachedGateway: LLMGateway | null = null;
function gateway(): LLMGateway {
  if (cachedGateway) return cachedGateway;
  const env = loadEnv();
  cachedGateway = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    } as Parameters<typeof createLLMGateway>[0]['providers'],
  });
  return cachedGateway;
}

// ──────────────── System Prompt 模板 ────────────────

const SYSTEM_PROMPT_BASE = `你是 LoveRush 平台的贴心私人助理，帮客户找到合适的按摩技师。

你的风格：
- 像一个懂分寸又温暖的朋友，不像 AI / 客服
- 直接说话，不要"作为助手我..."这种开场
- 句子简洁，2-4 句一段，必要时一句话就够
- 用客户的母语（中文为主，按 locale 切换）
- 不输出 emoji 除非用户先用了
- 不主动提"AI / 助理 / 系统 / 算法"等技术词

绝对禁止：
- 编造客户没说过的喜好、过往
- 编造平台没有的功能
- 让客户离开平台联系（违反平台中转规则）
- 给医疗建议 / 法律建议 / 心理咨询

你能做：
- 推荐合适的技师（基于客户偏好和历史）
- 帮客户表达不好意思直说的需求
- 用客户母语翻译技师消息（带文化注解）
- 帮客户备份关键决策（价格 / 时间 / 地点）`;

function buildSystemPrompt(args: { customerProfile?: { tone?: string }; locale: string }): string {
  const tone = args.customerProfile?.tone ?? '温柔';
  return `${SYSTEM_PROMPT_BASE}\n\n当前客户偏好语气：${tone}\n用户语言：${args.locale}`;
}

async function buildGreetingMessages(
  ctx: AssistantContext,
  customerId: string,
): Promise<{ system: string; messages: LLMMessage[]; locale: string }> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, customerId) });
  const profile = await ctx.db.query.customerAssistantProfile.findFirst({
    where: eq(customerAssistantProfile.userId, customerId),
  });
  const master = await ctx.db.query.customerMasterPreferences.findFirst({
    where: eq(customerMasterPreferences.userId, customerId),
  });
  const session = await ctx.db.query.customerSessionPreferences.findFirst({
    where: eq(customerSessionPreferences.userId, customerId),
  });

  const locale = u?.locale ?? 'zh';
  const displayName = u?.displayName ?? '亲';
  const tone =
    (profile?.personalityProfile as { tone?: string } | null)?.tone ?? master?.communicationStyle ?? '温柔';

  const context = [
    `客户昵称：${displayName}`,
    master?.bodyTypePrefs?.length ? `偏好身材：${master.bodyTypePrefs.join('/')}` : null,
    master?.serviceStylePrefs?.length ? `偏好风格：${master.serviceStylePrefs.join('/')}` : null,
    session?.currentMood ? `当前情绪：${session.currentMood}` : null,
    session?.currentIntent ? `当前意图：${session.currentIntent}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const userInstruction = `请基于以下客户上下文，写一句开场招呼，1-2 句，自然、有温度、不要用 "亲爱的客户" 这种生硬话；让客户感到你认识 ta、关心 ta；不要主动推销也不要主动推荐技师，等 ta 开口：\n${context || '（无更多上下文）'}`;

  return {
    system: buildSystemPrompt({ customerProfile: { tone }, locale }),
    messages: [{ role: 'user', content: userInstruction }],
    locale,
  };
}

export async function greet(ctx: AssistantContext, customerId: string): Promise<string> {
  const { system, messages } = await buildGreetingMessages(ctx, customerId);
  const res = await gateway().complete({
    tier: 'T2',
    system,
    messages,
    maxTokens: 150,
    temperature: 0.9,
    userId: customerId,
    tag: 'assistant.greet',
  });
  return res.content.trim();
}

const PREF_EXTRACT_SCHEMA_HINT = `严格输出 JSON：
{
  "bodyTypes": string[] | null,   // 如 "高挑" / "丰满" 等
  "styles": string[] | null,      // 如 "温柔" / "调皮" / "专业" 等
  "budgetRangeMinPoints": number | null,
  "budgetRangeMaxPoints": number | null,
  "communicationStyle": string | null  // 用户偏好的沟通风格
}
没有则字段为 null。不要任何其他文字。`;

export async function inferPreferences(
  ctx: AssistantContext,
  customerId: string,
  userMessage: string,
): Promise<void> {
  const res = await gateway().complete({
    tier: 'T2',
    system: '你是偏好抽取器，从用户消息中识别其按摩偏好，严格按 JSON 输出。',
    messages: [{ role: 'user', content: `用户消息：${userMessage}\n\n${PREF_EXTRACT_SCHEMA_HINT}` }],
    maxTokens: 200,
    temperature: 0,
    userId: customerId,
    tag: 'assistant.infer',
  });

  let parsed: {
    bodyTypes?: string[] | null;
    styles?: string[] | null;
    budgetRangeMinPoints?: number | null;
    budgetRangeMaxPoints?: number | null;
    communicationStyle?: string | null;
  };
  try {
    parsed = JSON.parse(res.content.trim());
  } catch {
    return; // 模型偶尔不守 JSON，丢弃本次推断
  }

  const patch: Record<string, unknown> = {};
  if (parsed.bodyTypes?.length) patch.bodyTypePrefs = parsed.bodyTypes;
  if (parsed.styles?.length) patch.serviceStylePrefs = parsed.styles;
  if (parsed.budgetRangeMinPoints != null) patch.budgetRangeMinPoints = parsed.budgetRangeMinPoints;
  if (parsed.budgetRangeMaxPoints != null) patch.budgetRangeMaxPoints = parsed.budgetRangeMaxPoints;
  if (parsed.communicationStyle) patch.communicationStyle = parsed.communicationStyle;

  if (Object.keys(patch).length === 0) return;

  const existing = await ctx.db.query.customerMasterPreferences.findFirst({
    where: eq(customerMasterPreferences.userId, customerId),
  });
  if (existing) {
    await ctx.db
      .update(customerMasterPreferences)
      .set({ ...(patch as Record<string, unknown>), updatedAt: new Date() })
      .where(eq(customerMasterPreferences.userId, customerId));
  } else {
    await ctx.db.insert(customerMasterPreferences).values({ userId: customerId, ...(patch as Record<string, unknown>) });
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function chat(
  ctx: AssistantContext,
  customerId: string,
  userMessage: string,
  history: ChatTurn[] = [],
): Promise<string> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, customerId) });
  const profile = await ctx.db.query.customerAssistantProfile.findFirst({
    where: eq(customerAssistantProfile.userId, customerId),
  });

  const tone = (profile?.personalityProfile as { tone?: string } | null)?.tone ?? '温柔';
  const system = buildSystemPrompt({ customerProfile: { tone }, locale: u?.locale ?? 'zh' });

  const trimmed = history.slice(-10); // 最近 10 轮
  const messages: LLMMessage[] = [
    ...trimmed.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userMessage },
  ];

  const res = await gateway().complete({
    tier: 'T1',
    system,
    messages,
    maxTokens: 400,
    temperature: 0.7,
    userId: customerId,
    tag: 'assistant.chat',
  });

  // 异步偏好学习（不阻塞回复）
  fireAndForget(inferPreferences(ctx, customerId, userMessage), 'assistant.infer_preferences_failed', { customerId });

  return res.content.trim();
}
