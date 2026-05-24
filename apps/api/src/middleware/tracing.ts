/**
 * 链路追踪中间件
 *
 * - 生成 / 透传 request_id（hono/request-id 已内置）
 * - 记录 user_id / method / path / 状态 / 耗时 / 错误码到结构化日志
 */

import { Context, MiddlewareHandler, Next } from 'hono';
import { logger } from '../services/logger';

export interface AccessLog {
  request_id?: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  user_id?: string;
  ip?: string;
  user_agent?: string;
  error_code?: string;
}

export interface TracingOptions {
  /** 自定义日志输出（默认走 logger.info('http_access', ...)） */
  log?: (entry: AccessLog) => void;
}

export function tracing(opts: TracingOptions = {}): MiddlewareHandler {
  const log =
    opts.log ?? ((entry: AccessLog) => logger.info('http_access', entry as unknown as Record<string, unknown>));

  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;

    const userId = c.get('userId') as string | undefined;
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip');

    log({
      request_id: c.get('requestId') as string | undefined,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: duration,
      user_id: userId,
      ip,
      user_agent: c.req.header('user-agent'),
    });
  };
}
