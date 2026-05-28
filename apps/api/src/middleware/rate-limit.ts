/**
 * 限流中间件 · PRD §10.12
 *
 * 基于 @upstash/ratelimit 的滑窗算法。
 * 默认按 IP + userId 双维度，业务路由可覆盖。
 *
 * 命中限流 → 429 E9000_RATE_LIMITED，响应头带 X-RateLimit-* 元信息
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { HttpError } from './errors';

export interface RateLimiter {
  limit(identifier: string): Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
  }>;
}

export interface RateLimitOptions {
  limiter: RateLimiter;
  /** 取 identifier 的函数：默认 userId > IP */
  identify?: (c: Context) => string;
  /** 跳过条件（健康检查 / 内网） */
  skip?: (c: Context) => boolean;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const identify =
    opts.identify ??
    ((c: Context) => {
      const userId = c.get('userId') as string | undefined;
      if (userId) return `u:${userId}`;
      const ip =
        c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown';
      return `ip:${ip}`;
    });

  return async (c: Context, next: Next) => {
    if (opts.skip?.(c)) return next();

    const id = identify(c);
    const { success, limit, remaining, reset } = await opts.limiter.limit(id);

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(reset));

    if (!success) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
      throw HttpError.rateLimited('too many requests');
    }

    return next();
  };
}
