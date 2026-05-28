/**
 * 1→3 精准匹配 + 推荐理由 · PRD §3.2 F03-D1
 *
 * 算法:
 *   1. 调 services/recommend.ts 的现有打分(已含偏好命中/关系/行为模式/在线优先)
 *   2. 多兴趣簇并取 召回(每簇 Top N) → 去重 → 二次合并
 *   3. L5 diff 权重叠乘
 *   4. Haiku 给每候选生成 50 字推荐理由 + 重排
 *
 * 返回:topN(默认 3) · 每个含 reason + factor breakdown
 */

import type { LLMGateway } from '@loverush/llm';
import type { Database } from '@loverush/db';
import { recommend as baseRecommend, type Candidate, type RecommendContext } from '../recommend';
import { readReference, type MemoryContext } from './memory';
import { diffsToWeights } from './diff';
import { readClusters } from './clusterer';

export interface RecommenderContext extends RecommendContext, MemoryContext {
  db: Database;
}

export interface RecommendArgs {
  userId: string;
  city?: string;
  intent?: string;
  topN?: number;
}

export interface RecommendedItem extends Candidate {
  reason: string;
  clusterIdx?: number;
  weight: number;
}

const REASON_SYS = `你是按摩平台的推荐理由生成器 · 风格"好哥们" · PRD §5。

输入:技师 brief + 客户最近的关系层片段 + 客户当前意图。
输出:一句 30-50 字的中文推荐理由 · 直接称"你" · 不用"您" · 不背模板。

规则:
- 引用客户的具体偏好 / 上次评价(给出"为什么是 ta")
- 不夸客户("您说得太对了""完美的选择" 全禁)
- 不用 "作为 AI" 类自指
- 不堆 emoji
- 一句话搞定 · 不分段`;

const REASON_FALLBACK = '风格和你之前喜欢的接近 · 这个时段也有空';

async function genReason(
  gateway: LLMGateway,
  userId: string,
  args: {
    therapistBrief: string;
    intent?: string;
    relationSnippet?: string;
    clusterLabel?: string;
  },
): Promise<string> {
  const user = [
    `技师:${args.therapistBrief}`,
    args.relationSnippet ? `你最近的反馈:${args.relationSnippet}` : null,
    args.clusterLabel ? `命中你的兴趣簇:${args.clusterLabel}` : null,
    args.intent ? `你刚说:${args.intent}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await gateway.complete({
      tier: 'T2',
      system: REASON_SYS,
      messages: [{ role: 'user', content: user }],
      maxTokens: 80,
      temperature: 0.6,
      userId,
      tag: 'assistant.reason',
    });
    const text = res.content.trim();
    return text || REASON_FALLBACK;
  } catch {
    return REASON_FALLBACK;
  }
}

/**
 * 多簇并取召回:每个簇召 Top N · 合并去重
 * 实现注:当前 recall 已综合候选 → 用 cluster.weight 给二次提分
 */
export async function recommend(
  ctx: RecommenderContext,
  gateway: LLMGateway,
  args: RecommendArgs,
): Promise<RecommendedItem[]> {
  const topN = args.topN ?? 3;

  // 1. 基础打分 · 召 20 个
  const baseCandidates = await baseRecommend(ctx, {
    customerId: args.userId,
    city: args.city,
    intent: args.intent,
    topN: 20,
  });
  if (!baseCandidates.length) return [];

  // 2. 多兴趣簇加权
  const clusters = await readClusters(ctx, args.userId);
  const clusterByIdx = new Map(clusters.map((c) => [c.clusterIdx, c]));

  // 3. L5 diff 权重(降权某些技师)
  const diffs = await readReference(ctx, args.userId, 'diff', 20);
  const diffWeights = diffsToWeights(
    diffs.map((d) => ({
      refTherapistId: d.refTherapistId,
      content: d.content,
    })),
  );

  // 4. 二次评分:cluster boost + diff weight
  const enriched: Array<RecommendedItem> = baseCandidates.map((c) => {
    const tags = c.therapist.tags ?? [];
    // 找到与 tags 重叠度最高的簇
    let bestCluster: typeof clusters[0] | undefined;
    let bestOverlap = 0;
    for (const cl of clusters) {
      const overlap = (cl.topEntities ?? []).filter((e) => tags.includes(e)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCluster = cl;
      }
    }
    const clusterBoost = bestCluster ? bestCluster.weight / 100 : 1;
    const diffMultiplier = diffWeights.get(c.therapist.id) ?? 1;
    const finalScore = c.score * clusterBoost * diffMultiplier;
    return {
      ...c,
      reason: '',
      clusterIdx: bestCluster?.clusterIdx,
      weight: finalScore,
    };
  });

  enriched.sort((a, b) => b.weight - a.weight);
  const top = enriched.slice(0, topN);

  // 5. 给 Top N 生成理由(并发)
  const relations = await readReference(ctx, args.userId, 'relation', 5);
  const relationSnippetByT = new Map<string, string>();
  for (const r of relations) {
    if (r.refTherapistId && !relationSnippetByT.has(r.refTherapistId)) {
      relationSnippetByT.set(r.refTherapistId, r.content);
    }
  }

  const reasons = await Promise.all(
    top.map(async (item) => {
      const cluster = item.clusterIdx ? clusterByIdx.get(item.clusterIdx) : undefined;
      const brief = [
        `id ${item.therapist.id.slice(0, 8)}`,
        `城市:${item.therapist.serviceCity ?? '-'}`,
        `评分:${item.therapist.rating}`,
        `tags:${(item.therapist.tags ?? []).slice(0, 3).join(',')}`,
      ].join(' · ');
      return genReason(gateway, args.userId, {
        therapistBrief: brief,
        intent: args.intent,
        relationSnippet: relationSnippetByT.get(item.therapist.id),
        clusterLabel: cluster?.label ?? undefined,
      });
    }),
  );

  return top.map((item, i) => ({ ...item, reason: reasons[i]! }));
}
