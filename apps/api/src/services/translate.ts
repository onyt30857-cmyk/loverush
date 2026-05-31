/**
 * 翻译网关 · M05
 *
 * 主路径：DeepL（未接入时降级到 Claude T2）
 * 备路径：Claude T2 → Gemini Flash
 *
 * 翻译缓存（translation_cache）按 sha256(srcLang+tgtLang+text) 索引，
 * 命中即返回，未命中调 LLM 后回写。
 *
 * 文化注解：Claude 调用时一并产出 cultureNotes[]（关键短语 + 解释）。
 */

import { eq, sql } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  translationCache,
  type TranslationCache,
} from '@loverush/db';
import { fireAndForget } from './logger';
import {
  createLLMGateway,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type LLMGateway,
} from '@loverush/llm';
import { loadEnv } from '../env';

export interface TranslateContext {
  db: Database;
}

let gw: LLMGateway | null = null;
function gateway(): LLMGateway {
  if (gw) return gw;
  const env = loadEnv();
  gw = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    },
  });
  return gw;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface TranslateResult {
  text: string;
  cultureNotes: Array<{ phrase: string; note: string }>;
  provider: string;
  cached: boolean;
}

async function lookupCache(
  ctx: TranslateContext,
  cacheKey: string,
): Promise<TranslationCache | null> {
  const row = await ctx.db.query.translationCache.findFirst({
    where: eq(translationCache.cacheKey, cacheKey),
  });
  if (row) {
    // bump hit count async
    fireAndForget(
      ctx.db
        .update(translationCache)
        .set({ hitCount: sql`${translationCache.hitCount} + 1`, lastHitAt: new Date() })
        .where(eq(translationCache.cacheKey, cacheKey)),
      'translate.cache_hit_bump_failed',
      { cacheKey },
    );
  }
  return row ?? null;
}

const TRANSLATE_PROMPT = `你是按摩行业的专业翻译。请把下方文本翻译成 {{tgt}}，保持自然口语风格，并识别 1-3 个对外语用户可能造成误解的关键短语，每个给一句简短文化背景注解。

【严格输出格式】
直接输出原始 JSON 字符串。**禁止**用 markdown 代码块 \`\`\`...\`\`\` 包裹。**禁止**前缀/后缀任何说明文字。第一个字符必须是 \`{\`，最后一个字符必须是 \`}\`。

JSON 结构：
{
  "translation": string,
  "cultureNotes": [{ "phrase": string, "note": string }]
}

原文（{{src}}）：
{{text}}`;

const LANG_NAME: Record<string, string> = {
  zh: '简体中文',
  en: 'English',
  th: 'ภาษาไทย（泰语）',
  vi: 'Tiếng Việt（越南语）',
  ms: 'Bahasa Melayu（马来语）',
  id: 'Bahasa Indonesia（印尼语）',
};

export async function translate(
  ctx: TranslateContext,
  args: { text: string; srcLang: string; tgtLang: string; userId?: string },
): Promise<TranslateResult> {
  if (args.srcLang === args.tgtLang) {
    return { text: args.text, cultureNotes: [], provider: 'noop', cached: false };
  }

  const cacheKey = await sha256Hex(`${args.srcLang}|${args.tgtLang}|${args.text}`);
  const cached = await lookupCache(ctx, cacheKey);
  if (cached) {
    return {
      text: cached.tgtText,
      cultureNotes: (cached.cultureNotes ?? []),
      provider: 'cache',
      cached: true,
    };
  }

  const prompt = TRANSLATE_PROMPT.replace('{{src}}', LANG_NAME[args.srcLang] ?? args.srcLang)
    .replace('{{tgt}}', LANG_NAME[args.tgtLang] ?? args.tgtLang)
    .replace('{{text}}', args.text);

  const res = await gateway().complete({
    tier: 'T2',
    system: '你是按摩行业的专业翻译，严格按 JSON 输出。',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 600,
    temperature: 0.3,
    userId: args.userId,
    tag: 'translate',
  });

  let parsed: { translation: string; cultureNotes: Array<{ phrase: string; note: string }> };
  // bug 修(2026-06-01): Claude/Gemini 偶发把 JSON 用 ```json...``` 包裹,
  // 直接 JSON.parse 失败 → fallback 把整段 raw markdown 当 translation 入库,
  // 前端气泡显 "```json {translation:'...'}" 一坨 raw JSON 字符串 → 体验崩塌。
  // 防御性 strip code fence + 第二层 fallback 找 {...} 子串。
  let raw = res.content.trim();
  const fenceMatch = raw.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
  if (fenceMatch && fenceMatch[1]) raw = fenceMatch[1].trim();
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 第二层兜底:从乱糟糟文字里 grab 第一个 {...} 子串
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        parsed = JSON.parse(braceMatch[0]);
      } catch {
        // 真的没救 · 把整段当译文(至少不显 ```json 这种 raw 包裹)
        parsed = { translation: raw, cultureNotes: [] };
      }
    } else {
      parsed = { translation: raw, cultureNotes: [] };
    }
  }

  await ctx.db
    .insert(translationCache)
    .values({
      cacheKey,
      srcLanguage: args.srcLang,
      tgtLanguage: args.tgtLang,
      srcText: args.text,
      tgtText: parsed.translation,
      provider: res.provider,
      cultureNotes: parsed.cultureNotes,
    })
    .onConflictDoNothing();

  return {
    text: parsed.translation,
    cultureNotes: parsed.cultureNotes ?? [],
    provider: res.provider,
    cached: false,
  };
}
