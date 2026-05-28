/**
 * 多兴趣聚类 · KMeans(3-5 簇) · PRD §3.1 F03-M3
 *
 * 实现思路:
 * 1. 拉客户最近 N 条 L4 relation + L3 rotating
 * 2. 把每条记忆的 entities[] 转成稀疏 one-hot 向量(全局词典)
 * 3. KMeans 跑 3-5 个 k 值 · 取 silhouette 最高的
 * 4. 簇质心 + label(质心 Top 3 entity) 写 customer_interest_clusters
 *
 * 词典:全局 entity vocab(运行时建,不持久化),保证同一客户内一致
 * 复杂度:< 200 条记忆 × < 50 维 × 3-5 k → 单 user < 50ms
 *
 * 调度:由 jobs/assistant-clusterer.ts cron 每客户每天一次
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import {
  Database,
  customerReferenceMemory,
  customerInterestClusters,
  type CustomerReferenceMemory,
} from '@loverush/db';

export interface ClusterContext {
  db: Database;
}

const MIN_K = 3;
const MAX_K = 5;
const MIN_SAMPLES = 6; // 少于 6 条样本不聚类(用单一兴趣)

interface SampleVec {
  vec: number[];
  entities: string[];
  source: CustomerReferenceMemory;
}

function buildVocab(samples: CustomerReferenceMemory[]): string[] {
  const set = new Set<string>();
  for (const s of samples) {
    for (const e of s.entities ?? []) set.add(e);
  }
  return Array.from(set).sort();
}

function oneHot(entities: string[], vocab: string[]): number[] {
  const map = new Set(entities);
  return vocab.map((v) => (map.has(v) ? 1 : 0));
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

function meanVec(vecs: number[][]): number[] {
  if (!vecs.length) return [];
  const dim = vecs[0]!.length;
  const out = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i] ?? 0;
  return out.map((x) => x / vecs.length);
}

/**
 * 简易 KMeans++(确定性 seed)
 */
function kmeans(
  samples: SampleVec[],
  k: number,
  maxIter = 20,
): { assign: number[]; centroids: number[][] } {
  if (samples.length === 0 || k <= 0) return { assign: [], centroids: [] };
  if (samples.length <= k) {
    return {
      assign: samples.map((_, i) => i),
      centroids: samples.map((s) => s.vec),
    };
  }
  // 确定性 seed:取距离最远的 k 个起点
  const centroids: number[][] = [samples[0]!.vec];
  while (centroids.length < k) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < samples.length; i++) {
      const minToCent = Math.min(...centroids.map((c) => euclidean(samples[i]!.vec, c)));
      if (minToCent > bestDist) {
        bestDist = minToCent;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    centroids.push(samples[bestIdx]!.vec);
  }

  const assign = new Array(samples.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < samples.length; i++) {
      let bestK = 0;
      let bestD = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const d = euclidean(samples[i]!.vec, centroids[j]!);
        if (d < bestD) {
          bestD = d;
          bestK = j;
        }
      }
      if (assign[i] !== bestK) {
        assign[i] = bestK;
        changed = true;
      }
    }
    for (let j = 0; j < centroids.length; j++) {
      const inCluster = samples.filter((_, i) => assign[i] === j).map((s) => s.vec);
      if (inCluster.length > 0) centroids[j] = meanVec(inCluster);
    }
    if (!changed) break;
  }
  return { assign, centroids };
}

/**
 * 简易 silhouette · 近似版(平均簇内距离 vs 平均最近他簇距离)
 */
function silhouette(samples: SampleVec[], assign: number[]): number {
  if (samples.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const own = assign[i]!;
    const inOwn = samples.filter((_, j) => j !== i && assign[j] === own);
    const a = inOwn.length
      ? inOwn.reduce((s, sj) => s + euclidean(samples[i]!.vec, sj.vec), 0) / inOwn.length
      : 0;
    const otherClusters = Array.from(new Set(assign.filter((c) => c !== own)));
    if (!otherClusters.length) continue;
    const b = Math.min(
      ...otherClusters.map((c) => {
        const inC = samples.filter((_, j) => assign[j] === c);
        if (!inC.length) return Infinity;
        return inC.reduce((s, sj) => s + euclidean(samples[i]!.vec, sj.vec), 0) / inC.length;
      }),
    );
    if (!Number.isFinite(b)) continue;
    const denom = Math.max(a, b);
    sum += denom === 0 ? 0 : (b - a) / denom;
  }
  return sum / samples.length;
}

function topEntities(samples: SampleVec[], vocab: string[], assignK: number, assign: number[]): string[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < samples.length; i++) {
    if (assign[i] !== assignK) continue;
    for (const e of samples[i]!.entities) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([e]) => e);
}

function makeLabel(topEnts: string[]): string {
  if (!topEnts.length) return '综合偏好';
  return topEnts.slice(0, 2).join(' / ');
}

/**
 * 对单客户跑聚类 + 写表
 */
export async function clusterForUser(
  ctx: ClusterContext,
  userId: string,
): Promise<{ clusters: number; samples: number; bestK?: number; silhouette?: number }> {
  // 拉 L3 + L4 当前有效记忆 · 最多 200 条
  const samples = await ctx.db.query.customerReferenceMemory.findMany({
    where: and(
      eq(customerReferenceMemory.userId, userId),
      isNull(customerReferenceMemory.validTo),
      isNull(customerReferenceMemory.archivedAt),
    ),
    orderBy: [desc(customerReferenceMemory.recordedAt)],
    limit: 200,
  });
  if (samples.length < MIN_SAMPLES) {
    return { clusters: 0, samples: samples.length };
  }
  const vocab = buildVocab(samples);
  if (vocab.length === 0) {
    return { clusters: 0, samples: samples.length };
  }
  const svecs: SampleVec[] = samples.map((s) => ({
    vec: oneHot(s.entities ?? [], vocab),
    entities: s.entities ?? [],
    source: s,
  }));

  let bestK = MIN_K;
  let bestSil = -Infinity;
  let bestRes: { assign: number[]; centroids: number[][] } | null = null;
  for (let k = MIN_K; k <= Math.min(MAX_K, svecs.length); k++) {
    const res = kmeans(svecs, k);
    const sil = silhouette(svecs, res.assign);
    if (sil > bestSil) {
      bestSil = sil;
      bestK = k;
      bestRes = res;
    }
  }
  if (!bestRes) return { clusters: 0, samples: samples.length };

  // 清旧簇 + 写新簇
  await ctx.db.delete(customerInterestClusters).where(eq(customerInterestClusters.userId, userId));
  const rows = [];
  for (let j = 0; j < bestRes.centroids.length; j++) {
    const topEnts = topEntities(svecs, vocab, j, bestRes.assign);
    const sampleSize = bestRes.assign.filter((a) => a === j).length;
    rows.push({
      userId,
      clusterIdx: j + 1, // 1-based
      label: makeLabel(topEnts),
      centroid: bestRes.centroids[j],
      sampleSize,
      topEntities: topEnts,
      weight: Math.max(20, Math.round((sampleSize / svecs.length) * 100)),
    });
  }
  if (rows.length) {
    await ctx.db.insert(customerInterestClusters).values(rows);
  }
  return {
    clusters: rows.length,
    samples: samples.length,
    bestK,
    silhouette: bestSil,
  };
}

/**
 * 读所有簇(供推荐召回用)
 */
export async function readClusters(ctx: ClusterContext, userId: string) {
  return ctx.db.query.customerInterestClusters.findMany({
    where: eq(customerInterestClusters.userId, userId),
    orderBy: [desc(customerInterestClusters.weight)],
  });
}
