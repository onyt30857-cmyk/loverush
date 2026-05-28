/**
 * 偏好抽取器 · PRD §3.1 F03-M4
 *
 * 双路并行:
 *   ① 规则路:正则 + 关键词,即时同步,99% 场景够用
 *   ② LLM 路:Haiku NER + 抽实体,异步补强,补足规则路漏的语境理解
 *
 * 输入源(PRD §3.1 F03-M4):
 *   - 浏览停留时长(由调用方传 viewDuration)
 *   - 收藏 / 取消收藏(由 favorite 写入触发)
 *   - 评分 + 评价文本(NER)
 *   - 对话中提到的偏好实体
 *   - 取消订单 / 退款的原因
 *   - 预约时段规律(由 outreach.ts 聚合)
 *
 * 输出:写入 L2 / L3 / L4 · 调用 memory.ts
 */

import { z } from 'zod';
import type { LLMGateway } from '@loverush/llm';
import type { Database } from '@loverush/db';
import { writeRotating, writeRelation, upsertSaved, invalidate, type MemoryContext } from './memory';
import { redact } from './redact';

// ──────────────── 规则路 ────────────────

const LIKE_HINTS = ['喜欢', '想要', '可以', '不错', '舒服', 'like', 'love', 'into', 'prefer'];
const DISLIKE_HINTS = ['不喜欢', '不要', '讨厌', '反感', '不舒服', 'dislike', 'hate', 'avoid', 'no '];
const PRICE_LOW = ['便宜', '性价比', '划算', 'cheap', 'budget', 'affordable'];
const PRICE_HIGH = ['高端', '奢华', '档次', 'premium', 'luxury', 'high-end'];
const TIME_HINTS = /(\d{1,2})\s*(:|点|am|pm)/i;

const STYLE_DICT: Record<string, string[]> = {
  温柔: ['温柔', '细腻', '细致', 'gentle', 'soft', 'tender'],
  活力: ['活力', '外向', '热情', 'energetic', 'outgoing'],
  专业: ['专业', '正规', '资深', 'professional', 'experienced'],
  调皮: ['调皮', '俏皮', '可爱', 'playful', 'cute'],
  安静: ['安静', '不爱聊天', '少话', 'quiet', "doesn't chat", 'no talk'],
  重手法: ['手法重', '力度大', '深层', 'deep tissue', 'strong pressure'],
  轻手法: ['轻一点', '力度轻', '放松', 'light pressure', 'relaxing'],
};

export interface ExtractedSignals {
  likedStyles: string[];
  dislikedStyles: string[];
  likedTherapists: string[]; // 名字 token 化
  dislikedTherapists: string[];
  priceBand?: 'low' | 'mid' | 'high';
  entities: string[]; // NER 抽到的所有实体(用于 cluster)
  taboo: string[];
  source: 'rule' | 'llm';
}

/**
 * 规则路抽取 · 同步 · 0 LLM
 */
export function extractByRules(text: string): ExtractedSignals {
  const lower = text.toLowerCase();
  const liked: string[] = [];
  const disliked: string[] = [];
  const entities: string[] = [];

  // 风格抽取 · 双向(是否被"不要 / 不喜欢"否定)
  for (const [style, hints] of Object.entries(STYLE_DICT)) {
    for (const h of hints) {
      const idx = lower.indexOf(h.toLowerCase());
      if (idx >= 0) {
        entities.push(style);
        // 检查前 10 字是否有否定词
        const before = lower.slice(Math.max(0, idx - 10), idx);
        const isNeg = DISLIKE_HINTS.some((d) => before.includes(d.toLowerCase()));
        if (isNeg) disliked.push(style);
        else liked.push(style);
        break;
      }
    }
  }

  // 价位段
  let priceBand: 'low' | 'mid' | 'high' | undefined;
  if (PRICE_LOW.some((p) => lower.includes(p.toLowerCase()))) priceBand = 'low';
  else if (PRICE_HIGH.some((p) => lower.includes(p.toLowerCase()))) priceBand = 'high';

  // 时间偏好
  const timeMatch = text.match(TIME_HINTS);
  if (timeMatch) entities.push(`time_${timeMatch[0]}`);

  return {
    likedStyles: Array.from(new Set(liked)),
    dislikedStyles: Array.from(new Set(disliked)),
    likedTherapists: [],
    dislikedTherapists: [],
    priceBand,
    entities: Array.from(new Set(entities)),
    taboo: [],
    source: 'rule',
  };
}

// ──────────────── LLM 路(Haiku) ────────────────

const LLM_SCHEMA_HINT = `从客户文本中抽取按摩服务偏好实体,严格输出 JSON · 不输出任何其他文字:

{
  "liked_styles": string[],          // 喜欢的风格(温柔/活力/专业/调皮/安静/重手法/轻手法 等)
  "disliked_styles": string[],       // 不喜欢的
  "liked_therapists": string[],      // 提到名字 + 正面评价的技师
  "disliked_therapists": string[],   // 提到名字 + 负面评价的技师
  "price_band": "low" | "mid" | "high" | null,
  "entities": string[],              // 其它实体(精油 / 时段 / 场地等)
  "taboo": string[]                  // 永久禁忌(医学 / 心理边界)
}

只抽客户**明确表达过**的,不要推断没说过的。空字段返回 [] 或 null。`;

const Parsed = z.object({
  liked_styles: z.array(z.string()).default([]),
  disliked_styles: z.array(z.string()).default([]),
  liked_therapists: z.array(z.string()).default([]),
  disliked_therapists: z.array(z.string()).default([]),
  price_band: z.enum(['low', 'mid', 'high']).nullable().default(null),
  entities: z.array(z.string()).default([]),
  taboo: z.array(z.string()).default([]),
});

export async function extractByLLM(
  gateway: LLMGateway,
  text: string,
  userId?: string,
): Promise<ExtractedSignals> {
  const res = await gateway.complete({
    tier: 'T2',
    system: '你是按摩 spa 偏好抽取器 · 严格按 JSON 输出 · 不写解释。',
    messages: [{ role: 'user', content: `${LLM_SCHEMA_HINT}\n\n客户文本:\n${text}` }],
    maxTokens: 300,
    temperature: 0,
    userId,
    tag: 'assistant.extractor',
  });
  let parsed: z.infer<typeof Parsed>;
  try {
    const obj = JSON.parse(res.content.trim());
    parsed = Parsed.parse(obj);
  } catch {
    return {
      likedStyles: [],
      dislikedStyles: [],
      likedTherapists: [],
      dislikedTherapists: [],
      entities: [],
      taboo: [],
      source: 'llm',
    };
  }
  return {
    likedStyles: parsed.liked_styles,
    dislikedStyles: parsed.disliked_styles,
    likedTherapists: parsed.liked_therapists,
    dislikedTherapists: parsed.disliked_therapists,
    priceBand: parsed.price_band ?? undefined,
    entities: parsed.entities,
    taboo: parsed.taboo,
    source: 'llm',
  };
}

/**
 * 合并两路结果
 */
export function mergeSignals(a: ExtractedSignals, b: ExtractedSignals): ExtractedSignals {
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  return {
    likedStyles: uniq([...a.likedStyles, ...b.likedStyles]),
    dislikedStyles: uniq([...a.dislikedStyles, ...b.dislikedStyles]),
    likedTherapists: uniq([...a.likedTherapists, ...b.likedTherapists]),
    dislikedTherapists: uniq([...a.dislikedTherapists, ...b.dislikedTherapists]),
    priceBand: a.priceBand ?? b.priceBand,
    entities: uniq([...a.entities, ...b.entities]),
    taboo: uniq([...a.taboo, ...b.taboo]),
    source: 'rule',
  };
}

// ──────────────── 落地到 5 层记忆 ────────────────

export interface PersistContext extends MemoryContext {
  db: Database;
}

export interface PersistArgs {
  userId: string;
  signals: ExtractedSignals;
  /** 关联到的实体上下文(可选) */
  refTherapistId?: string;
  refOrderId?: string;
  /** 是 rotating(近期想试)还是 relation(对某技师的具体反馈) */
  intent: 'rotating' | 'relation';
}

/**
 * 把 ExtractedSignals 持久化到 L2/L3/L4
 *
 * 规则:
 * - 风格喜欢/不喜欢 → L2 stable_prefs(累加去重)
 * - taboo → L2 taboo_zones(累加去重)
 * - rotating intent → 整段写 L3
 * - relation intent + refTherapistId → 整段写 L4 + bi-temporal 失效旧的同 therapist 记忆
 */
export async function persist(ctx: PersistContext, args: PersistArgs): Promise<void> {
  const s = args.signals;

  // L2 累加
  const stablePatch: Record<string, unknown> = {};
  if (s.likedStyles.length) {
    stablePatch.priorities = s.likedStyles;
  }
  if (s.dislikedStyles.length) {
    stablePatch.dislikes = s.dislikedStyles;
  }
  if (s.priceBand) {
    stablePatch.priceBand = s.priceBand;
  }
  const savedPatch: Parameters<typeof upsertSaved>[2] = {};
  if (Object.keys(stablePatch).length) savedPatch.stablePrefs = stablePatch;
  if (s.taboo.length) savedPatch.tabooZones = s.taboo;
  if (Object.keys(savedPatch).length) {
    await upsertSaved(ctx, args.userId, savedPatch);
  }

  // L3 / L4
  const summary = [
    s.likedStyles.length ? `喜欢:${s.likedStyles.join(',')}` : null,
    s.dislikedStyles.length ? `不喜欢:${s.dislikedStyles.join(',')}` : null,
    s.likedTherapists.length ? `好评技师:${s.likedTherapists.join(',')}` : null,
    s.dislikedTherapists.length ? `差评技师:${s.dislikedTherapists.join(',')}` : null,
    s.priceBand ? `价位:${s.priceBand}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (!summary) return;
  // 端云分层:再次脱敏服务端兜底
  const cleaned = redact(summary).cleaned;

  if (args.intent === 'rotating') {
    await writeRotating(ctx, args.userId, {
      content: cleaned,
      entities: s.entities,
      importance: 5,
    });
  } else if (args.intent === 'relation' && args.refTherapistId) {
    // bi-temporal:失效该 therapist 旧 relation 行
    await invalidate(ctx, {
      userId: args.userId,
      type: 'relation',
      matchRefTherapistId: args.refTherapistId,
    });
    await writeRelation(ctx, args.userId, {
      therapistId: args.refTherapistId,
      orderId: args.refOrderId,
      content: cleaned,
      entities: s.entities,
      importance: 6,
    });
  }
}

/**
 * 高阶:从一段客户文本 → 抽取 → 落地
 */
export async function extractAndPersist(
  ctx: PersistContext,
  gateway: LLMGateway,
  args: {
    userId: string;
    text: string;
    intent: 'rotating' | 'relation';
    refTherapistId?: string;
    refOrderId?: string;
    /** 是否同步等 LLM 结果(否则 fire-and-forget) */
    awaitLLM?: boolean;
  },
): Promise<ExtractedSignals> {
  const ruleSignals = extractByRules(args.text);
  // 规则同步落地
  await persist(ctx, {
    userId: args.userId,
    signals: ruleSignals,
    refTherapistId: args.refTherapistId,
    refOrderId: args.refOrderId,
    intent: args.intent,
  });
  // LLM 异步补强
  const llmPromise = extractByLLM(gateway, args.text, args.userId).then(async (llmSignals) => {
    const merged = mergeSignals(ruleSignals, llmSignals);
    await persist(ctx, {
      userId: args.userId,
      signals: llmSignals,
      refTherapistId: args.refTherapistId,
      refOrderId: args.refOrderId,
      intent: args.intent,
    });
    return merged;
  });
  if (args.awaitLLM) return llmPromise;
  // fire-and-forget · 错误吞掉但不抛
  llmPromise.catch(() => undefined);
  return ruleSignals;
}
