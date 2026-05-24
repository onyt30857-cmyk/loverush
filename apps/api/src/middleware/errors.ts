/**
 * 统一错误处理中间件 · PRD §10.10
 *
 * 业务侧抛 HttpError，中间件统一转 ApiResponse 格式。
 * 未捕获异常一律返回 E9999_INTERNAL_ERROR，原始堆栈仅写日志不外露。
 */

import { Context, MiddlewareHandler, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { ErrorCode, ErrorCodeType, ApiError, ApiResponse } from '@loverush/types';
import { logger } from '../services/logger';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCodeType,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(code: ErrorCodeType, message: string, details?: Record<string, unknown>) {
    return new HttpError(400, code, message, details);
  }
  static unauthorized(code: ErrorCodeType = ErrorCode.E1001_OTP_INVALID, message = 'unauthorized') {
    return new HttpError(401, code, message);
  }
  static forbidden(code: ErrorCodeType, message: string) {
    return new HttpError(403, code, message);
  }
  static notFound(code: ErrorCodeType = ErrorCode.E0003_RESOURCE_NOT_FOUND, message = 'not found') {
    return new HttpError(404, code, message);
  }
  static conflict(code: ErrorCodeType, message: string) {
    return new HttpError(409, code, message);
  }
  static rateLimited(message = 'rate limited') {
    return new HttpError(429, ErrorCode.E9000_RATE_LIMITED, message);
  }
  static internal(message = 'internal error') {
    return new HttpError(500, ErrorCode.E9999_INTERNAL_ERROR, message);
  }
}

function buildErrorResponse(c: Context, err: HttpError): ApiResponse<never> {
  const requestId = c.get('requestId') ?? c.req.header('x-request-id') ?? undefined;
  const apiError: ApiError = {
    code: err.code,
    message: err.message,
    details: err.details,
    request_id: requestId,
    timestamp: new Date().toISOString(),
  };
  return { error: apiError, request_id: requestId };
}

// 用 duck typing 而不是 instanceof：vitest forks pool 可能让同一个文件被 import 成两份
// module（path 不同），instanceof 失败 · err.name === 'HttpError' 更稳
function isHttpError(err: unknown): err is HttpError {
  return (
    err instanceof HttpError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'HttpError' &&
      typeof (err as { status?: unknown }).status === 'number' &&
      typeof (err as { code?: unknown }).code === 'string')
  );
}

// Hono `app.onError` 形式的全局错误处理。
//
// 为什么用 onError 而不是 middleware：sub-app（如 `app.route('/me', meRoutes)`）的
// throw 不会冒泡到外层 middleware 的 try/catch，但会触发 Hono 实例的 errorHandler。
// 用 `app.onError(onErrorHandler)` 在入口注册全局兜底，所有 sub-app 共用。
export const onErrorHandler = (err: Error, c: Context): Response => {
  // 已知业务错误
  if (isHttpError(err)) {
    return c.json(buildErrorResponse(c, err), err.status as 400 | 401 | 403 | 404 | 409 | 429);
  }

  // Zod 校验错误
  if (err instanceof ZodError) {
    const httpErr = new HttpError(400, ErrorCode.E0001_INVALID_PARAM, 'invalid params', {
      issues: err.issues,
    });
    return c.json(buildErrorResponse(c, httpErr), 400);
  }

  // Hono 内置异常
  if (err instanceof HTTPException) {
    const httpErr = new HttpError(
      err.status,
      ErrorCode.E0000_UNKNOWN,
      err.message || 'http exception',
    );
    return c.json(buildErrorResponse(c, httpErr), err.status as 400 | 401 | 403 | 404 | 429 | 500);
  }

  // 兜底：未知异常
  logger.error('unhandled exception', {
    err,
    requestId: c.get('requestId') as string | undefined,
    userId: c.get('userId') as string | undefined,
    path: c.req.path,
    method: c.req.method,
  });
  // Sentry 上报（fire-and-forget · 不阻塞响应）
  void (async () => {
    try {
      const sentry = await import('../services/sentry');
      await sentry.captureException(err, {
        userId: c.get('userId') as string | undefined,
        requestId: c.get('requestId') as string | undefined,
        path: c.req.path,
        method: c.req.method,
      });
    } catch {}
  })();
  const internal = HttpError.internal();
  return c.json(buildErrorResponse(c, internal), 500);
};

// 兼容旧用法：保留 errorHandler middleware（同样调 onErrorHandler）。
// 但 sub-app 的错误**只能**通过 app.onError(onErrorHandler) 捕获。
export const errorHandler: MiddlewareHandler = async (c: Context, next: Next) => {
  try {
    await next();
  } catch (err) {
    return onErrorHandler(err as Error, c);
  }
  return;
};
