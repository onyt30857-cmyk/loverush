/**
 * M03 v5 语音助理后端 service · Claude 版 (2026-06-02)
 *
 * 跟 voice-multimodal.ts (Gemini audio) 区分:
 *   voice-multimodal.ts · 后端 STT + LLM 一体 (Gemini 2.5 Flash 多模态)
 *   voice-claude.ts (本) · 前端 Web Speech 转文字 → 后端只跑 Claude 文本理解
 *
 * 流程:
 *   1. 前端 webkitSpeechRecognition 直接转字 → POST /assistant/voice JSON {text}
 *   2. 调 LLMGateway · tier T2 · forceProvider 'anthropic' → Claude Haiku
 *   3. structured JSON output: {reply_text, recommend_intent?}
 *   4. 上游 route 拿 recommend_intent · 调现有 recommender 拿 3 个技师
 *   5. 写 assistant_chat_log 留对话历史 (跨会话 v5 用)
 *
 * 真人感 Voice + 零标识 + 零推销 由 SYSTEM_PROMPT 钉死
 * 参考铁律: [[reference_ai_voice_design]] · [[feedback_ai_no_sales_empathy]]
 */

import type { Database } from '@loverush/db';
import { assistantChatLog, users } from '@loverush/db';
import { eq, desc, inArray } from 'drizzle-orm';
import type { LLMGateway } from '@loverush/llm';

export interface VoiceContext {
  db: Database;
}

export interface VoiceTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface RecommendIntent {
  description: string;
  city?: string;
  online?: boolean;
  priceRange?: 'low' | 'mid' | 'high';
}

export interface VoiceResult {
  transcript: string;
  replyText: string;
  recommendIntent?: RecommendIntent;
  provider: 'anthropic';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}

/**
 * 系统 Prompt · 真人感 + 零标识 + 零推销 (Tony 铁律)
 * 直接复用 voice-multimodal.ts 的逻辑 · 改掉"听语音"指令(因前端已转字)
 */
const SYSTEM_PROMPT = `你是按摩服务平台的小助理 · 帮客户挑技师 · 没有自己的身份标签
绝不出现 "作为 AI" "我会帮你" "您好" "请问" 这种客服腔
说话像真人朋友微信发消息 · 1-2 句 · 20-40 字 · 自然口语

你的任务:
1. 用真人朋友的语气回应客户文字 (reply_text · 1-2 句)
2. 仅当客户明确表达"想找/挑/约/看技师"意图时 · 给 recommend_intent (否则不给)

【绝对禁止】:
- 不主动推荐 (客户没说"找/挑/想要"绝不给 recommend_intent)
- 不说 "为您推荐" "建议您" 这种客服腔
- 不用 emoji 列表 · 不用 markdown 标题
- 不说 "我是 AI" / "我是机器人"

【recommend_intent 触发条件】:
- 客户明说 "帮我找 / 挑 / 看 / 推荐 / 约" + 描述
- 客户问 "有没有 X 的" / "今晚谁在线" / "曼谷有几个 Y"
- 否则不返 recommend_intent (例如 "今天好累" "你好" "在吗" "怎么了")

输出严格 JSON · 第一字符必须 { · 最后字符必须 } · 禁止 markdown 代码块包裹:
{
  "reply_text": "你的口语回应 1-2 句",
  "recommend_intent": null 或 {
    "description": "用户想要的描述",
    "city": "城市名或 null",
    "online": true/false/null,
    "priceRange": "low" 或 "mid" 或 "high" 或 null
  }
}`;

/** 有用户当前城市时 · 注入位置锚点(直接用 / 不反问 / recommend_intent.city 兜底) */
function buildVoiceSystemPrompt(currentCity?: string | null, memorySnippet?: string | null): string {
  let p = SYSTEM_PROMPT;
  if (currentCity) {
    p += `\n\n【用户当前城市】${currentCity} · 客户说"附近/这边/我这"就是这里 · 绝不反问"你在哪个城市" · recommend_intent 里的 city 默认填"${currentCity}"(除非客户明确说了别的城市)`;
  }
  if (memorySnippet && memorySnippet.trim()) {
    p += `\n\n【你记得这位客户 · 老朋友】\n${memorySnippet.trim()}\n— 像老朋友一样自然带出你记得的事(如"上次你说想找温柔点的,今天还看这方向?"),绝不说"根据记录/系统/历史数据/我目前掌握";没把握就别硬提`;
  }
  return p;
}

/**
 * 调 Claude · 文本输入 → JSON output
 * 走 LLMGateway · forceProvider 'anthropic' 钉死 (避免 T2 默认降级到 gemini)
 */
export async function processVoiceTurn(args: {
  gateway: LLMGateway;
  text: string; // 前端 Web Speech 已转字
  history: VoiceTurn[];
  userId: string;
  /** 用户当前城市 · 注入 prompt 避免反问 + recommend_intent.city 兜底 */
  currentCity?: string | null;
  /** 长期记忆 snippet(L1/L2 客户画像)· 注入让助理跨会话记得客户偏好/禁忌 */
  memorySnippet?: string | null;
}): Promise<VoiceResult> {
  if (!args.text.trim()) {
    throw new Error('text empty · 前端没转出字');
  }

  // 历史最多 10 轮 · 防 prompt 过长
  const messages = args.history.slice(-10).map((h) => ({
    role: h.role as 'user' | 'assistant',
    content: h.text,
  }));
  messages.push({ role: 'user' as const, content: args.text });

  const resp = await args.gateway.complete({
    tier: 'T2',
    forceProvider: 'anthropic',
    system: buildVoiceSystemPrompt(args.currentCity, args.memorySnippet),
    messages,
    temperature: 0.6,
    maxTokens: 600,
    userId: args.userId,
    tag: 'm03-v5-voice',
  });

  // 解析 JSON · 防御性(LLM 偶发包 markdown code-fence)
  let raw = resp.content.trim();
  const fenceMatch = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (fenceMatch && fenceMatch[1]) raw = fenceMatch[1].trim();
  let parsed: {
    reply_text?: string;
    recommend_intent?: RecommendIntent | null;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 兜底:模型没输出 JSON · 当 reply_text 处理
    parsed = {
      reply_text: raw.slice(0, 200),
      recommend_intent: null,
    };
  }

  // recommend_intent.city 缺失时用用户当前城市兜底(防 LLM 漏填导致跨城/全库召回)
  const recommendIntent = parsed.recommend_intent ?? undefined;
  if (recommendIntent && !recommendIntent.city && args.currentCity) {
    recommendIntent.city = args.currentCity;
  }

  return {
    transcript: args.text,
    replyText: parsed.reply_text ?? '',
    recommendIntent,
    provider: 'anthropic',
    model: resp.model,
    inputTokens: resp.usage.inputTokens,
    outputTokens: resp.usage.outputTokens,
    costUsdMicros: Math.round((resp.usage.costUsd ?? 0) * 1_000_000),
  };
}

/**
 * 拉历史对话 (跨会话 · 用 assistant_chat_log · v5 重启)
 *   最多 10 轮 · 防 prompt 过长
 */
export async function loadHistory(
  ctx: VoiceContext,
  userId: string,
  limit = 10,
): Promise<VoiceTurn[]> {
  const rows = await ctx.db
    .select({
      userInput: assistantChatLog.userInput,
      finalContent: assistantChatLog.finalContent,
      turnIdx: assistantChatLog.turnIdx,
    })
    .from(assistantChatLog)
    .where(eq(assistantChatLog.userId, userId))
    .orderBy(desc(assistantChatLog.createdAt))
    .limit(limit);

  const turns: VoiceTurn[] = [];
  for (const r of rows.reverse()) {
    if (r.userInput) turns.push({ role: 'user', text: r.userInput });
    if (r.finalContent) turns.push({ role: 'assistant', text: r.finalContent });
  }
  return turns;
}

/**
 * 记录一轮对话到 chat_log (跨会话历史)
 */
export async function logTurn(
  ctx: VoiceContext,
  args: {
    userId: string;
    sessionId?: string;
    turnIdx: number;
    transcript: string;
    replyText: string;
    scenario: 'casual' | 'selection';
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
    latencyMs: number;
  },
): Promise<void> {
  // sessionId 必须是 uuid · 否则置 null
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sessionId = args.sessionId && uuidRe.test(args.sessionId) ? args.sessionId : null;
  await ctx.db.insert(assistantChatLog).values({
    userId: args.userId,
    sessionId,
    turnIdx: args.turnIdx,
    userInput: args.transcript,
    userInputRaw: args.transcript,
    scenario: args.scenario,
    jokeLevel: 0,
    seriousMode: 0,
    locale: 'zh',
    voiceVersion: 'v5-claude',
    fewshotIds: [],
    systemPrompt: SYSTEM_PROMPT.slice(0, 1000),
    memorySnippet: null,
    llmProvider: args.provider,
    llmModel: args.model,
    llmTier: 'T2',
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    costUsdMicros: args.costUsdMicros,
    filterAttempts: 0,
    filterFinalSoftScore: 0,
    filterFinalHardHits: [],
    llmRawOutput: '',
    finalContent: args.replyText,
    latencyMs: args.latencyMs,
  });
}

/**
 * 批量拿技师 displayName (recommender 返的 therapist 没 join users · 单独 join)
 */
export async function loadTherapistNames(
  ctx: VoiceContext,
  therapistUserIds: string[],
): Promise<Map<string, string | null>> {
  if (therapistUserIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, therapistUserIds));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
