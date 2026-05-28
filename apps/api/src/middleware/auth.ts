/**
 * JWT 鉴权中间件
 *
 * 从 Authorization: Bearer <token> 中解析 JWT，
 * 校验签名 + 过期 + sessions 表 revokedAt，挂 userId 到 context。
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { jwtVerify } from 'jose';
import { eq, isNull, and } from 'drizzle-orm';
import { sessions } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from './errors';
import { loadEnv } from '../env';
import { getDb } from '../db';

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const requireAuth: MiddlewareHandler = async (c: Context, next: Next) => {
  const header = c.req.header('authorization') ?? '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'missing bearer token');

  const token = m[1]!;
  const env = loadEnv();

  let payload: { sub?: string; typ?: string };
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), {
      issuer: env.JWT_ISSUER,
    });
    payload = result.payload;
  } catch {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'invalid or expired token');
  }

  if (payload.typ !== 'access') {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'wrong token type');
  }
  if (!payload.sub) {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'no subject');
  }

  // 校验 session 未被撤销
  const tokenHash = await sha256Hex(token);
  const session = await getDb().query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)),
  });
  if (!session) {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'session revoked');
  }

  c.set('userId', payload.sub);
  c.set('sessionId', session.id);
  return next();
};
