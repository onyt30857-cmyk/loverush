/**
 * M03 v5 语音助理后端 service (2026-06-02 [[loverush_m03_audit_2026_06_01]] v5)
 *
 * 跟 v3 voice.ts 区分:
 *   voice.ts                 · v3 prompt 装配 (Tony 留作 fallback)
 *   voice-multimodal.ts (本) · v5 Gemini multimodal · audio → text + 回复 + 推荐意图
 *
 * 流程:
 *   1. 客户端 MediaRecorder 录音 → POST /assistant/voice (multipart audio + history)
 *   2. 转 base64 + 调 Gemini 2.5 Flash multimodal (audio + text history)
 *   3. structured JSON output: {transcript, reply_text, recommend_intent?}
 *   4. 上游 route 拿到 recommend_intent · 调现有 recommender 拿 3 个技师
 *   5. 写 assistant_chat_log 留对话历史 (跨会话 v5 用)
 *   6. 返 {transcript, replyText, recommendations}
 *
 * Gemini 直 fetch (绕 LLM gateway · 因 gateway content:string 不支持 multimodal)
 *
 * 真人感 Voice + 零标识 + 零推销 由 SYSTEM_PROMPT 钉死
 * 参考铁律: [[reference_ai_voice_design]] · [[feedback_ai_no_sales_empathy]]
 */

import type { Database } from '@loverush/db';
import { assistantChatLog, users } from '@loverush/db';
import { eq, desc, inArray } from 'drizzle-orm';
import { loadEnv } from '../../env';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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
  provider: 'gemini-2.5-flash';
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}

/**
 * 系统 Prompt · 真人感 + 零标识 + 零推销 (Tony 铁律)
 */
const SYSTEM_PROMPT = `你是按摩服务平台的小助理 · 帮客户挑技师 · 没有自己的身份标签
绝不出现 "作为 AI" "我会帮你" "您好" "请问" 这种客服腔
说话像真人朋友微信发消息 · 1-2 句 · 20-40 字 · 自然口语

你的任务:
1. 听懂客户语音说什么 (transcript 转文字)
2. 用真人朋友的语气回应 (reply_text · 1-2 句)
3. 仅当客户明确表达"想找/挑/约/看技师"意图时 · 给 recommend_intent (否则不给)

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
  "transcript": "原话转文字",
  "reply_text": "你的口语回应 1-2 句",
  "recommend_intent": null 或 {
    "description": "用户想要的描述",
    "city": "城市名或 null",
    "online": true/false/null,
    "priceRange": "low" 或 "mid" 或 "high" 或 null
  }
}`;

/**
 * 调 Gemini 2.5 Flash multimodal · audio in + text history → JSON output
 */
export async function processVoiceTurn(args: {
  audioBase64: string;
  mimeType: string; // 'audio/webm' | 'audio/mp4'
  history: VoiceTurn[];
}): Promise<VoiceResult> {
  const env = loadEnv();
  const apiKey = env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY missing · M03 v5 voice 无法工作');
  }

  // 历史最多 10 轮 · 防 prompt 过长
  const contents: Array<{
    role: 'user' | 'model';
    parts: Array<Record<string, unknown>>;
  }> = [];
  for (const h of args.history.slice(-10)) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    });
  }
  // 当前音频
  contents.push({
    role: 'user',
    parts: [
      { inlineData: { mimeType: args.mimeType, data: args.audioBase64 } },
      { text: '听这段语音 · 按 system 规则输出 JSON' },
    ],
  });

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 600,
      responseMimeType: 'application/json',
    },
  };

  const url = `${GEMINI_URL_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) {
    throw new Error('Gemini 返回空内容');
  }

  // 解析 JSON · 防御性 (LLM 偶发包 markdown code-fence)
  let raw = text.trim();
  const fenceMatch = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (fenceMatch && fenceMatch[1]) raw = fenceMatch[1].trim();
  let parsed: {
    transcript?: string;
    reply_text?: string;
    recommend_intent?: RecommendIntent | null;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 兜底:模型没输出 JSON · 当 reply_text 处理
    parsed = {
      transcript: '[转文字失败]',
      reply_text: raw.slice(0, 200),
      recommend_intent: null,
    };
  }

  // 成本估算 Gemini 2.5 Flash
  // input audio: ~$0.10/M tokens · output: ~$0.30/M tokens
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd =
    (inputTokens / 1_000_000) * 0.1 + (outputTokens / 1_000_000) * 0.3;

  return {
    transcript: parsed.transcript ?? '',
    replyText: parsed.reply_text ?? '',
    recommendIntent: parsed.recommend_intent ?? undefined,
    provider: 'gemini-2.5-flash',
    inputTokens,
    outputTokens,
    costUsdMicros: Math.round(costUsd * 1_000_000),
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

  // 倒序拉 → 翻正序 + 展开成 user/assistant 交替
  const turns: VoiceTurn[] = [];
  for (const r of rows.reverse()) {
    if (r.userInput) turns.push({ role: 'user', text: r.userInput });
    if (r.finalContent) turns.push({ role: 'assistant', text: r.finalContent });
  }
  return turns;
}

/**
 * 记录一轮对话到 chat_log (跨会话历史 · v5 重启 deprecated)
 */
export async function logTurn(
  ctx: VoiceContext,
  args: {
    userId: string;
    sessionId?: string; // uuid · 客户端可能不传 (此时 null)
    turnIdx: number;
    transcript: string;
    replyText: string;
    scenario: 'casual' | 'selection';
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
    latencyMs: number;
  },
): Promise<void> {
  // sessionId 必须是 uuid · 否则置 null (chat_log.session_id 是 fk to assistant_sessions · v5 暂不用 sessions 表)
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
    seriousMode: 0, // schema: integer 0/1 (不是 boolean)
    locale: 'zh',
    voiceVersion: 'v5-multimodal',
    fewshotIds: [],
    systemPrompt: SYSTEM_PROMPT.slice(0, 1000),
    memorySnippet: null,
    llmProvider: args.provider,
    llmModel: GEMINI_MODEL,
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
