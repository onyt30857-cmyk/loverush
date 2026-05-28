/**
 * 凭证链工具 · M07
 *
 * 每条订单维护一条 append-only 事件链，每条事件包含：
 *   event_hash = sha256(prev_hash + canonical(payload) + seq + event_type)
 *
 * 链头从 prev_hash = "GENESIS" 开始。
 * 验证整条链：逐项重算 event_hash，与存储值比对即可。
 */

import { eq, and, desc } from 'drizzle-orm';
import type { Database} from '@loverush/db';
import { orderChain, type OrderChain } from '@loverush/db';

export const GENESIS_HASH = 'GENESIS';

/**
 * 规范化 payload 用于哈希（JSON 排序键、去 undefined）
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeEventHash(args: {
  prevHash: string;
  seq: number;
  eventType: string;
  payload: unknown;
}): Promise<string> {
  const input = `${args.prevHash}|${args.seq}|${args.eventType}|${canonicalize(args.payload)}`;
  return await sha256Hex(input);
}

/**
 * 在订单链末尾 append 一条新事件
 * 返回新事件的 seq + hash
 */
export async function appendChainEvent(
  db: Database,
  args: {
    orderId: string;
    event: OrderChain['event'];
    payload: Record<string, unknown>;
    actorUserId?: string;
    actorRole?: 'customer' | 'therapist' | 'system' | 'admin';
  },
): Promise<{ seq: number; hash: string }> {
  const last = await db.query.orderChain.findFirst({
    where: eq(orderChain.orderId, args.orderId),
    orderBy: [desc(orderChain.seq)],
  });

  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.eventHash ?? GENESIS_HASH;

  const eventHash = await computeEventHash({
    prevHash,
    seq,
    eventType: args.event,
    payload: args.payload,
  });

  await db.insert(orderChain).values({
    orderId: args.orderId,
    seq,
    event: args.event,
    payload: args.payload,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    prevHash,
    eventHash,
  });

  return { seq, hash: eventHash };
}

/**
 * 验证整条订单链的完整性
 * 任何一条事件被篡改 → 重算 hash 不匹配 → 返回 invalid
 */
export async function verifyChain(
  db: Database,
  orderId: string,
): Promise<{ valid: boolean; brokenAtSeq?: number }> {
  const events = await db.query.orderChain.findMany({
    where: eq(orderChain.orderId, orderId),
    orderBy: [orderChain.seq],
  });

  let prevHash = GENESIS_HASH;
  for (const e of events) {
    const recomputed = await computeEventHash({
      prevHash,
      seq: e.seq,
      eventType: e.event,
      payload: e.payload,
    });
    if (recomputed !== e.eventHash || e.prevHash !== prevHash) {
      return { valid: false, brokenAtSeq: e.seq };
    }
    prevHash = e.eventHash;
  }
  return { valid: true };
}

/**
 * 计算价格锁哈希（订单进入 LOCKED 时调用）
 * 写入 orders.price_lock_hash，后续比对防篡改
 */
export async function computePriceLockHash(args: {
  orderId: string;
  pricePoints: number;
  serviceSnapshot: unknown;
  lockedAt: Date;
}): Promise<string> {
  const input = `LOCK|${args.orderId}|${args.pricePoints}|${canonicalize(args.serviceSnapshot)}|${args.lockedAt.toISOString()}`;
  return await sha256Hex(input);
}
