/**
 * 幂等键中间件 · PRD §10.11
 *
 * 客户端在写操作（POST/PUT/PATCH/DELETE）携带 Idempotency-Key 头，
 * 服务端用 Redis 短期缓存 (key, requestHash, response) 24h。
 *
 * 命中：直接返回缓存的 response（同一 key 相同 hash）
 * 冲突：相同 key 不同 hash → 409 E0002_IDEMPOTENCY_CONFLICT
 * 未带：写操作允许通过（业务侧自行幂等），但记录 warning
 */

import { Context, MiddlewareHandler, Next } from 'hono';
import { ErrorCode } from '@loverush/types';
import { HttpError } from './errors';

export interface IdempotencyStore {
  get(key: string): Promise<{ hash: string; status: number; body: string } | null>;
  set(
    key: string,
    value: { hash: string; status: number; body: string },
    ttlSeconds: number,
  ): Promise<void>;
}

export interface IdempotencyOptions {
  store: IdempotencyStore;
  ttlSeconds?: number;
  /** 哪些方法需要幂等保护 */
  methods?: string[];
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function idempotency(opts: IdempotencyOptions): MiddlewareHandler {
  const ttl = opts.ttlSeconds ?? 24 * 3600;
  const methods = new Set(opts.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']);

  return async (c: Context, next: Next) => {
    if (!methods.has(c.req.method)) return next();

    const key = c.req.header('idempotency-key');
    if (!key) return next();

    const body = await c.req.raw.clone().text();
    const requestHash = await sha256(`${c.req.method}:${c.req.path}:${body}`);
    const cacheKey = `idem:${c.get('userId') ?? 'anon'}:${key}`;

    const cached = await opts.store.get(cacheKey);
    if (cached) {
      if (cached.hash !== requestHash) {
        throw HttpError.conflict(
          ErrorCode.E0002_IDEMPOTENCY_CONFLICT,
          'idempotency key reused with different payload',
        );
      }
      c.header('X-Idempotency-Replayed', '1');
      return c.body(cached.body, cached.status as 200, {
        'content-type': 'application/json; charset=utf-8',
      });
    }

    await next();

    // 仅缓存成功响应（2xx）
    if (c.res.status >= 200 && c.res.status < 300) {
      const resClone = c.res.clone();
      const respBody = await resClone.text();
      await opts.store.set(
        cacheKey,
        { hash: requestHash, status: c.res.status, body: respBody },
        ttl,
      );
    }
  };
}
