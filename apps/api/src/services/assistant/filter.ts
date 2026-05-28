/**
 * 反 AI slop filter · PRD §5.5
 *
 * 硬 filter (hit即重 sample,≤3 次):
 *   "作为一个 AI 助手" / "As an AI" / "您说得太对了" / "Great question" / ...
 *
 * 软 filter (命中降分 / 警告):
 *   长句 / 连续 emoji / 中英混杂套话 / 反问 ...
 *
 * 接口:
 *   - lintHard(text) → { hits, shouldResample }
 *   - lintSoft(text) → { score, penalties }
 *   - filterOutput(text, resampler) → 自动重 sample 直到 hard 通过或耗光预算
 */

import type { LLMGateway, LLMMessage, LLMTierValue } from '@loverush/llm';

// ──────────────── 硬黑名单 ────────────────

export const HARD_BLACKLIST: { pattern: RegExp; label: string }[] = [
  { pattern: /作为(一个)?\s*AI(\s*(助理|助手|语言模型|大模型|模型))?/i, label: 'self_ai_label_zh' },
  { pattern: /\bAs an AI\b/i, label: 'self_ai_label_en' },
  { pattern: /\bAs a (large )?language model\b/i, label: 'self_ai_label_en2' },
  { pattern: /本\s*AI/i, label: 'self_ai_ben' },
  { pattern: /我永远在这里支持您|我会一直陪着您/, label: 'rizz_companion' },
  { pattern: /您说得太对了|您说得对极了/, label: 'sycophancy_zh' },
  { pattern: /\bGreat question\b/i, label: 'sycophancy_en' },
  { pattern: /这是一个非常好的问题|这是个特别好的问题/, label: 'great_question_zh' },
  { pattern: /希望我的回答(对您)?有(所)?帮助/, label: 'hope_helps' },
  { pattern: /还有什么(可以|能)帮(您|你)的吗/, label: 'anything_else' },
  { pattern: /^您好[,，]?/, label: 'greeting_nin' },
  { pattern: /请问您是否|请问您需要/, label: 'qing_wen_nin' },
  { pattern: /尊敬的客户/, label: 'esteemed_customer' },
  { pattern: /非常抱歉(给您)?带来不便/, label: 'apology_inconvenience' },
  { pattern: /(非常)?(深刻|极具)的?(洞见|洞察)/, label: 'sycophancy_insight' },
  { pattern: /完美的选择|绝佳的选择/, label: 'sycophancy_choice' },
  // 私聊里禁三段式
  { pattern: /^首先[，,].*其次[，,].*(最后|最终)/s, label: 'three_part_structure' },
];

// ──────────────── 软规则 ────────────────

export interface SoftPenalty {
  label: string;
  score: number; // 0-100,扣分
}

export function lintHard(text: string): {
  hits: string[];
  shouldResample: boolean;
} {
  const hits: string[] = [];
  for (const rule of HARD_BLACKLIST) {
    if (rule.pattern.test(text)) hits.push(rule.label);
  }
  return { hits, shouldResample: hits.length > 0 };
}

const EMOJI_RE =
  /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu;

export function lintSoft(text: string, locale: 'zh' | 'en' = 'zh'): {
  score: number;
  penalties: SoftPenalty[];
} {
  const penalties: SoftPenalty[] = [];

  // 长句
  if (locale === 'zh') {
    const sentences = text.split(/[。！？!?\n]/).filter(Boolean);
    const tooLong = sentences.filter((s) => s.trim().length > 35);
    if (tooLong.length) {
      penalties.push({ label: 'long_sentence_zh', score: tooLong.length * 5 });
    }
  } else {
    const sentences = text.split(/[.!?\n]/).filter(Boolean);
    const tooLong = sentences.filter((s) => s.trim().split(/\s+/).length > 18);
    if (tooLong.length) {
      penalties.push({ label: 'long_sentence_en', score: tooLong.length * 5 });
    }
  }

  // emoji 串(连续 2+)
  const emojis = text.match(EMOJI_RE) ?? [];
  if (emojis.length >= 2) {
    // 检测是否连续
    const consecutiveRe = /(\p{Extended_Pictographic}\s?){2,}/u;
    if (consecutiveRe.test(text)) {
      penalties.push({ label: 'consecutive_emoji', score: 10 });
    }
  }

  // 中英混杂套话
  if (/Sure[!,]?\s*[一-鿿]/.test(text) || /OK[!,]?\s*[一-鿿]/i.test(text)) {
    penalties.push({ label: 'codeswitch_filler', score: 8 });
  }

  // 反问"您具体是什么意思"
  if (/您具体是什么意思|您是指/.test(text)) {
    penalties.push({ label: 'vague_clarify', score: 6 });
  }

  // markdown 列表(在私聊场景)
  if (/^[\s]*[-*•]\s/m.test(text)) {
    penalties.push({ label: 'markdown_list', score: 5 });
  }

  const score = penalties.reduce((s, p) => s + p.score, 0);
  return { score, penalties };
}

/**
 * 整体可用判定
 */
export function isAcceptable(text: string, locale: 'zh' | 'en' = 'zh'): {
  ok: boolean;
  hardHits: string[];
  softScore: number;
  softPenalties: SoftPenalty[];
} {
  const hard = lintHard(text);
  const soft = lintSoft(text, locale);
  return {
    ok: !hard.shouldResample && soft.score < 30,
    hardHits: hard.hits,
    softScore: soft.score,
    softPenalties: soft.penalties,
  };
}

// ──────────────── 自动重 sample(配合 gateway) ────────────────

export interface ResampleArgs {
  gateway: LLMGateway;
  tier: LLMTierValue;
  system: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  tag?: string;
  locale?: 'zh' | 'en';
  maxAttempts?: number;
}

/**
 * 跑 LLM + 反 slop 防线
 * - 硬命中 → 加更严厉提示,重 sample
 * - 软命中 score≥30 → 加压缩提示,重 sample 1 次
 * - 超过预算返回最后一次的输出 + 记录
 */
export async function generateWithFilter(args: ResampleArgs): Promise<{
  content: string;
  attempts: number;
  finalSoftScore: number;
  finalHardHits: string[];
}> {
  const maxAttempts = args.maxAttempts ?? 3;
  const locale = args.locale ?? 'zh';
  let attempt = 0;
  let lastContent = '';
  let lastHard: string[] = [];
  let lastSoft = 0;
  let system = args.system;

  while (attempt < maxAttempts) {
    attempt++;
    const res = await args.gateway.complete({
      tier: args.tier,
      system,
      messages: args.messages,
      temperature: args.temperature ?? 0.7,
      maxTokens: args.maxTokens ?? 300,
      userId: args.userId,
      tag: args.tag,
    });
    const out = res.content.trim();
    lastContent = out;
    const verdict = isAcceptable(out, locale);
    lastHard = verdict.hardHits;
    lastSoft = verdict.softScore;
    if (verdict.ok) {
      return {
        content: out,
        attempts: attempt,
        finalSoftScore: verdict.softScore,
        finalHardHits: [],
      };
    }
    // 重 sample · 加更严厉的 voice 提示
    const reproach =
      locale === 'zh'
        ? `\n\n【重要 · 上一版本命中黑名单 ${verdict.hardHits.concat(verdict.softPenalties.map((p) => p.label)).join(' / ')}】\n请重写:不要 "作为 AI" "您说得太对了" "希望对您有帮助" 等套话;不要 markdown 列表;不要 emoji 串;短句 1-3 句。`
        : `\n\n[Reroll — last output hit ${verdict.hardHits.concat(verdict.softPenalties.map((p) => p.label)).join(' / ')}]\nRewrite: no "As an AI", no "Great question", no markdown bullets, no emoji walls. 1-3 short sentences.`;
    system = args.system + reproach;
  }
  return {
    content: lastContent,
    attempts: attempt,
    finalSoftScore: lastSoft,
    finalHardHits: lastHard,
  };
}
