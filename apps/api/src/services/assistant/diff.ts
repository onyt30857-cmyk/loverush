/**
 * 跨次比对 · L5 diff · PRD §6.3 + F03-M1
 *
 * 触发:订单创建 hook(预约前)/ 归档 job
 *
 * 流程:
 *   1. 拉客户最近 10 条 L4 relation(可按 therapistId 过滤)
 *   2. Sonnet 跑 diff:同一技师不同次的反差点、跨技师的偏好漂移
 *   3. 写入 L5(memory_type='diff') · importance 7
 *   4. 影响推荐排序权重(recommender.ts 调用)
 */

import type { LLMGateway } from '@loverush/llm';
import { writeDiff, readReference, type MemoryContext } from './memory';

export interface DiffContext extends MemoryContext {}

const DIFF_PROMPT_SYSTEM = `你是 LoveRush 的偏好分析师 · 比对客户跨次反馈,找出趋势变化。
输出严格 JSON · 不写解释:
{
  "diffs": [
    {
      "title": string,                    // 一句话趋势 · 例:"对 Lily 的满意度从 5 → 3.5"
      "ref_therapist_id": string | null,  // 若是单技师趋势,填该 therapist_id
      "evidence": string,                 // 1-2 句具体证据,引用原文实体
      "importance": number,               // 1-10
      "recommendation_weight": number     // 推荐排序权重调整,0.5 = 降权,1 = 不变,1.3 = 加权
    }
  ]
}

规则:
- 找不到趋势返回 {"diffs": []}
- 不要编造没出现过的实体
- 客户给同一技师评价"上次 5 分 → 这次 4 分"= 满意度下降,降权 0.7
- 客户对同类技师都给负面 = 偏好漂移,降权 0.5
- 一次性发现不超过 5 条`;

const DIFF_PROMPT_USER_PREFIX = '客户最近的关系层记忆(按时间倒序):\n';

interface ParsedDiff {
  title: string;
  ref_therapist_id?: string | null;
  evidence: string;
  importance: number;
  recommendation_weight: number;
}

/**
 * 对客户跑跨次 diff,写入 L5
 *
 * @returns 写入条数
 */
export async function diffForUser(
  ctx: DiffContext,
  gateway: LLMGateway,
  args: { userId: string; lookback?: number },
): Promise<number> {
  const lookback = args.lookback ?? 10;
  const relations = await readReference(ctx, args.userId, 'relation', lookback);
  if (relations.length < 2) return 0;

  const bullets = relations
    .map((r, i) => {
      const ts = r.recordedAt instanceof Date ? r.recordedAt.toISOString().slice(0, 10) : '';
      const tid = r.refTherapistId ? `[T:${r.refTherapistId.slice(0, 8)}]` : '';
      return `${i + 1}. (${ts}) ${tid} ${r.content}`;
    })
    .join('\n');

  const res = await gateway.complete({
    tier: 'T1',
    system: DIFF_PROMPT_SYSTEM,
    messages: [{ role: 'user', content: DIFF_PROMPT_USER_PREFIX + bullets }],
    maxTokens: 600,
    temperature: 0.2,
    userId: args.userId,
    tag: 'assistant.diff',
  });

  let parsed: { diffs?: ParsedDiff[] };
  try {
    parsed = JSON.parse(res.content.trim());
  } catch {
    return 0;
  }
  const diffs = parsed.diffs ?? [];
  if (!diffs.length) return 0;

  let written = 0;
  for (const d of diffs) {
    if (!d.title || !d.evidence) continue;
    await writeDiff(ctx, args.userId, {
      content: `${d.title} · ${d.evidence} · 推荐权重×${d.recommendation_weight.toFixed(2)}`,
      entities: d.ref_therapist_id ? [`therapist:${d.ref_therapist_id}`] : [],
      importance: Math.max(1, Math.min(10, d.importance)),
      refTherapistId: d.ref_therapist_id ?? undefined,
    });
    written++;
  }
  return written;
}

/**
 * 把 L5 diff 解析成推荐排序的权重 map(therapist_id → multiplier)
 */
export function diffsToWeights(
  diffs: Array<{ refTherapistId: string | null; content: string }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of diffs) {
    if (!d.refTherapistId) continue;
    // 解析 content 末尾的 "推荐权重×0.70"
    const m = d.content.match(/推荐权重×([\d.]+)/);
    if (m) {
      const w = parseFloat(m[1]!);
      if (Number.isFinite(w) && w > 0) {
        map.set(d.refTherapistId, w);
      }
    }
  }
  return map;
}
