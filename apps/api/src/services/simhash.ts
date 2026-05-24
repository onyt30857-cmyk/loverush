/**
 * 64-bit SimHash · M06 F06.26
 *
 * 用于反重复：同一技师 N 条话术的 simhash 入 simhash_index 表，
 * 新候选 simhash 与近 200 条比 Hamming，≤12 视为相似 → 重新生成。
 *
 * 实现走基础 token 哈希 + 加权累加；中文用 2-gram 切分。
 */

import { eq, desc } from 'drizzle-orm';
import { Database, simhashIndex } from '@loverush/db';

export interface SimhashContext {
  db: Database;
}

const SIMHASH_BITS = 64;
const SIMILAR_THRESHOLD = 12;

function tokenize(text: string): string[] {
  const cleaned = text.replace(/[\s\p{P}]+/gu, '');
  // 简单 2-gram；英文按 word
  if (/^[\x20-\x7E]+$/.test(cleaned)) {
    return cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  }
  const tokens: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.push(cleaned.slice(i, i + 2));
  }
  if (tokens.length === 0 && cleaned.length) tokens.push(cleaned);
  return tokens;
}

function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

export function computeSimhash(text: string): bigint {
  const tokens = tokenize(text);
  const weights = new Array<number>(SIMHASH_BITS).fill(0);

  for (const tok of tokens) {
    const h = fnv1a64(tok);
    for (let bit = 0; bit < SIMHASH_BITS; bit++) {
      const mask = 1n << BigInt(bit);
      if ((h & mask) !== 0n) weights[bit]! += 1;
      else weights[bit]! -= 1;
    }
  }

  let result = 0n;
  for (let bit = 0; bit < SIMHASH_BITS; bit++) {
    if (weights[bit]! > 0) result |= 1n << BigInt(bit);
  }
  return result;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/** 检查候选与最近 N 条是否相似（true = 相似，应重新生成） */
export async function isSimilarToRecent(
  ctx: SimhashContext,
  args: { therapistUserId: string; candidateSimhash: bigint; lookback?: number; threshold?: number },
): Promise<{ similar: boolean; closest?: { simhash: bigint; distance: number } }> {
  const recent = await ctx.db.query.simhashIndex.findMany({
    where: eq(simhashIndex.therapistUserId, args.therapistUserId),
    orderBy: [desc(simhashIndex.createdAt)],
    limit: args.lookback ?? 200,
  });

  const threshold = args.threshold ?? SIMILAR_THRESHOLD;
  let closest: { simhash: bigint; distance: number } | undefined;
  for (const row of recent) {
    const dist = hammingDistance(BigInt(row.simhash), args.candidateSimhash);
    if (!closest || dist < closest.distance) closest = { simhash: BigInt(row.simhash), distance: dist };
    if (dist <= threshold) return { similar: true, closest: { simhash: BigInt(row.simhash), distance: dist } };
  }
  return { similar: false, closest };
}

export async function recordSimhash(
  ctx: SimhashContext,
  args: { therapistUserId: string; simhash: bigint; sampleText?: string; scenario?: string },
): Promise<void> {
  await ctx.db.insert(simhashIndex).values({
    therapistUserId: args.therapistUserId,
    simhash: Number(args.simhash & 0x7fffffffffffffffn), // bigint → bigint columns store fine; 这里做 signed 兼容
    sampleText: args.sampleText?.slice(0, 200),
    scenario: args.scenario,
  });
}
