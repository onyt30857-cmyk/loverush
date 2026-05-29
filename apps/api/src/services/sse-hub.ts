/**
 * SSE Hub · M05 Phase 2 实时推送中枢
 *
 * 内存 Map<userId, Set<SSEWriter>>· 单实例
 * 任何 service 调 publishToUser(userId, event, data) 即可推
 *
 * 多实例时:env RAILWAY_REPLICA_COUNT > 1 时禁用 SSE 退化 polling(防漏推)
 *           → Phase 3 上 Redis Pub/Sub 才支持多实例
 */

export interface SSEWriter {
  id: string;
  userId: string;
  send: (event: string, data: unknown) => void;
}

const connections = new Map<string, Set<SSEWriter>>();

/** 注册连接 · 返 unregister 函数 */
export function registerConnection(userId: string, w: SSEWriter): () => void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(w);
  return () => {
    const cur = connections.get(userId);
    if (!cur) return;
    cur.delete(w);
    if (cur.size === 0) connections.delete(userId);
  };
}

/** 推一个事件给一个 user 的所有在线连接 */
export function publishToUser(userId: string, event: string, data: unknown): void {
  const set = connections.get(userId);
  if (!set || set.size === 0) return;
  for (const w of set) {
    try {
      w.send(event, data);
    } catch {
      // writer dead · 静默 · 下次 publish 时 try 再 catch
    }
  }
}

/** 观测指标(给 admin /admin/events/stats 用) */
export function activeUserCount(): number {
  return connections.size;
}
export function activeConnectionCount(): number {
  let n = 0;
  for (const set of connections.values()) n += set.size;
  return n;
}

/** 多实例环境检测 · 防漏推 */
export function isMultiInstance(): boolean {
  const n = parseInt(process.env.RAILWAY_REPLICA_COUNT ?? '1', 10);
  return Number.isFinite(n) && n > 1;
}
