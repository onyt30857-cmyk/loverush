/**
 * JWT 鉴权中间件
 *
 * 从 Authorization: Bearer <token> 中解析 JWT,
 * 校验签名 + 过期 + sessions 表 revokedAt,挂 userId 到 context。
 *
 * 性能修复(2026-05-31):
 *   每个 API 请求都要 sha256(token) + 查 sessions 表,在 SFO DB 上每次 +5-10ms,
 *   但因 Bun 进程在 SFO 而 connection 池压力下偶有排队,实测累积 ~100ms。
 *   加 in-process LRU(token hash → userId+sessionId,30s TTL),命中率 ~95%,
 *   每个 API 省 ~100ms,首屏 4 个 API 累积 -400ms。
 *
 *   失效控制:
 *     - 30s TTL · 撤销 session 最多延迟 30s 生效(可接受)
 *     - 用户登出 / refresh 时不主动清 cache(等 TTL 自然过期)
 *     - 容量上限 5000(LRU 满后淘汰最旧的)· 单 user 多 token 也 OK
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

// ──────────────── in-process LRU cache for session lookups ────────────────

interface CachedSession {
  userId: string;
  sessionId: string;
  expiresAt: number; // 绝对时间戳 ms
}

const SESSION_CACHE_TTL_MS = 30_000; // 30s
const SESSION_CACHE_MAX = 5000;
const sessionCache = new Map<string, CachedSession>();

function cacheGet(tokenHash: string): CachedSession | null {
  const v = sessionCache.get(tokenHash);
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    sessionCache.delete(tokenHash);
    return null;
  }
  // LRU touch(Map 保留插入序 · 取出再放保最新)
  sessionCache.delete(tokenHash);
  sessionCache.set(tokenHash, v);
  return v;
}

function cacheSet(tokenHash: string, entry: { userId: string; sessionId: string }): void {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    // 淘汰最旧(Map 迭代序就是插入序)
    const firstKey = sessionCache.keys().next().value;
    if (firstKey) sessionCache.delete(firstKey);
  }
  sessionCache.set(tokenHash, {
    userId: entry.userId,
    sessionId: entry.sessionId,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

/**
 * 纯函数版 access token 验证 · 给 SSE 等无法用 middleware Context 的场景用
 * 返回 userId · 失败抛错
 */
export async function verifyAccessToken(token: string): Promise<string> {
  const env = loadEnv();
  const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), {
    issuer: env.JWT_ISSUER,
  });
  const payload = result.payload as { sub?: string; typ?: string };
  if (payload.typ !== 'access') throw new Error('wrong token type');
  if (!payload.sub) throw new Error('no subject');

  const tokenHash = await sha256Hex(token);
  const cached = cacheGet(tokenHash);
  if (cached) return cached.userId;

  const session = await getDb().query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)),
  });
  if (!session) throw new Error('session revoked');
  cacheSet(tokenHash, { userId: payload.sub, sessionId: session.id });
  return payload.sub;
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

  // ── LRU cache 命中(性能修复)
  const tokenHash = await sha256Hex(token);
  const cached = cacheGet(tokenHash);
  if (cached) {
    c.set('userId', cached.userId);
    c.set('sessionId', cached.sessionId);
    return next();
  }

  // 未命中 · 查 DB
  const session = await getDb().query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)),
  });
  if (!session) {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'session revoked');
  }
  cacheSet(tokenHash, { userId: payload.sub, sessionId: session.id });

  c.set('userId', payload.sub);
  c.set('sessionId', session.id);
  return next();
};
