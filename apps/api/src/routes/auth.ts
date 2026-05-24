/**
 * 认证路由 · M01
 *
 * POST /auth/register    匿名注册（生成助记词）
 * POST /auth/recover     助记词找回
 * POST /auth/refresh     刷新 access token
 * POST /auth/logout      撤销当前 session
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { register, recover, AuthContext } from '../services/auth';
import { getDb } from '../db';
import { loadEnv } from '../env';

function buildCtx(): AuthContext {
  const env = loadEnv();
  return {
    db: getDb(),
    jwtSecret: new TextEncoder().encode(env.JWT_SECRET),
    jwtIssuer: env.JWT_ISSUER,
    accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
  };
}

const RegisterBody = z.object({
  user_type: z.enum(['customer', 'therapist']),
  invite_code: z.string().min(4).max(64),
  display_name: z.string().min(1).max(32).optional(),
  locale: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']).optional(),
  device_fingerprint_hash: z.string().optional(),
});

const RecoverBody = z.object({
  mnemonic: z.string().min(10), // 24 词最少 ~95 字符
  device_fingerprint_hash: z.string().optional(),
});

function clientIp(c: { req: { header: (k: string) => string | undefined } }) {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip')
  );
}

async function hashOptional(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const authRoutes = new Hono();

authRoutes.post('/register', zValidator('json', RegisterBody), async (c) => {
  const body = c.req.valid('json');
  const ctx = buildCtx();
  const ipHash = await hashOptional(clientIp(c));

  const result = await register(ctx, {
    userType: body.user_type,
    inviteCode: body.invite_code,
    displayName: body.display_name,
    locale: body.locale,
    ipHash,
    deviceFingerprintHash: body.device_fingerprint_hash,
    userAgent: c.req.header('user-agent'),
  });

  return c.json({
    data: {
      user: result.user,
      mnemonic: result.mnemonic,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_at: result.expiresAt,
    },
  });
});

authRoutes.post('/recover', zValidator('json', RecoverBody), async (c) => {
  const body = c.req.valid('json');
  const ctx = buildCtx();
  const ipHash = await hashOptional(clientIp(c));

  const { user, tokens } = await recover(ctx, {
    mnemonic: body.mnemonic.trim().toLowerCase(),
    ipHash,
    deviceFingerprintHash: body.device_fingerprint_hash,
    userAgent: c.req.header('user-agent'),
  });

  return c.json({
    data: {
      user: { id: user.id, user_type: user.userType, display_name: user.displayName },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
    },
  });
});
