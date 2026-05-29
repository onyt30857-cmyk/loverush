/**
 * 搜索自然语言解析 · Phase 2
 *
 * 输入:自然语言 query("在曼谷的165cm+泰式技师")
 * 输出:结构化条件 + 未识别的尾巴(作为 search 关键词兜底)
 *
 * 实现:
 *  - 短查询(≤ 6 字)→ 跳过 LLM · 走纯关键词
 *  - 长查询 → Haiku JSON mode 解析
 *  - LLM 失败/超时 → 退化为关键词搜索(原 raw query 作 search)
 *
 * Voice 不参与 · 这是工具调用 · 用 system prompt 强制 JSON。
 */

import type { LLMGateway } from '@loverush/llm';

export interface ParsedSearchQuery {
  /** 城市(LLM 识别) */
  city?: string;
  /** 身高下限(cm)*/
  height_min?: number;
  /** 身高上限(cm)*/
  height_max?: number;
  /** 国籍 */
  nationality?: string;
  /** 语言要求(中/英/泰/越/印尼/马) */
  language?: string;
  /** 技能/风格(泰式/油压/足疗/SPA) · 匹配 skillsJson[].skill */
  skill?: string;
  /** 在线状态 · true = online_status='online' */
  online?: boolean;
  /** 评分下限(0-50)· 4.5★ = 45 */
  score_min?: number;
  /** 未识别的尾巴 · 作为 fulltext search 兜底 */
  search?: string;
  /** AI 总结(可选 · 用户可见 "我帮你找曼谷 165cm+ 的泰式技师") */
  summary?: string;
  /** 解析失败 · 整个 q 作为 search */
  fallback?: boolean;
}

const SYSTEM_PROMPT = `You are a query parser for a massage therapist marketplace in Southeast Asia.

Parse user's natural-language search into JSON.

Schema (all optional except summary):
{
  "city": "曼谷 | 普吉 | 芭提雅 | 清迈 | 胡志明 | 雅加达 | 吉隆坡 | 新加坡 | null",
  "height_min": <int cm | null>,
  "height_max": <int cm | null>,
  "nationality": "中国 | 泰国 | 越南 | 韩国 | 日本 | null",
  "language": "中文 | 英文 | 泰文 | 越南文 | null",
  "skill": "泰式 | 油压 | 足疗 | SPA | 推拿 | null",
  "online": <bool | null>,
  "score_min": <int 0-50 · 4.5★=45 · null>,
  "search": "<剩余未识别的关键词 · 比如名字 · null>",
  "summary": "<一句话总结,例 '帮你找曼谷 165cm+ 泰式'>"
}

Rules:
- 不要编造没说的条件
- height "165+" / "1.65 以上" → height_min=165
- "高个" / "矮" 等模糊词 → 忽略
- "评分高" / "口碑好" → score_min=45
- "今晚有空" / "在线" → online=true
- Output ONLY JSON · no markdown · no explanation.
- summary 用 user 的语言(中文输入回中文 · 英文回英文)`;

/**
 * 快速判定:是否值得调 LLM 解析
 */
function isSimpleQuery(q: string): boolean {
  const trimmed = q.trim();
  // 短 · ≤ 8 字符 · 看作关键词
  if (trimmed.length <= 8) return true;
  // 不含中文连接词 / 介词 → 看作关键词组合
  if (!/[的在想找帮要给我会和与]/.test(trimmed)) {
    // 也没有空格分隔的多词 · 当成单个名字
    if (!/\s/.test(trimmed)) return true;
  }
  return false;
}

/**
 * 主入口 · 解析自然语言查询
 */
export async function parseSearchNlp(
  gateway: LLMGateway | null,
  query: string,
): Promise<ParsedSearchQuery> {
  const q = query.trim();
  if (!q) return { fallback: true };

  // 简单查询 → 直接关键词搜
  if (isSimpleQuery(q)) {
    return { search: q };
  }

  // 长查询 + LLM 可用 → 调用 Haiku 解析
  if (!gateway) {
    return { search: q, fallback: true };
  }

  try {
    const res = await gateway.complete({
      tier: 'T1', // Haiku · 便宜快
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: q }],
      temperature: 0.1,
      maxTokens: 200,
      tag: 'search.nlp_parse',
    });

    const content = res.content.trim();
    // 容错:可能 AI 把 JSON 包了 ```json...```
    const jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const out: ParsedSearchQuery = {};
    if (typeof parsed.city === 'string') out.city = parsed.city;
    if (typeof parsed.height_min === 'number') out.height_min = parsed.height_min;
    if (typeof parsed.height_max === 'number') out.height_max = parsed.height_max;
    if (typeof parsed.nationality === 'string') out.nationality = parsed.nationality;
    if (typeof parsed.language === 'string') out.language = parsed.language;
    if (typeof parsed.skill === 'string') out.skill = parsed.skill;
    if (typeof parsed.online === 'boolean') out.online = parsed.online;
    if (typeof parsed.score_min === 'number') out.score_min = parsed.score_min;
    if (typeof parsed.search === 'string' && parsed.search.length > 0) out.search = parsed.search;
    if (typeof parsed.summary === 'string') out.summary = parsed.summary;

    // 全空 → fallback
    const hasAny =
      out.city || out.height_min || out.height_max || out.nationality ||
      out.language || out.skill || out.online !== undefined || out.score_min || out.search;
    if (!hasAny) {
      return { search: q, fallback: true };
    }
    return out;
  } catch {
    // LLM 解析失败 → 退化关键词
    return { search: q, fallback: true };
  }
}
