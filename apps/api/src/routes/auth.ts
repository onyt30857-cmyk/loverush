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
import type { AuthContext } from '../services/auth';
import { register, recover, refresh, registerSimple, loginSimple } from '../services/auth';
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
  // invite_code 可选 · 空时 register 服务跳过校验(公开邀约期)
  // 客户端运营策略:首批客户/技师无需邀请码,后续按需要打开校验
  invite_code: z.string().min(4).max(64).optional(),
  display_name: z.string().min(1).max(32).optional(),
  locale: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']).optional(),
  device_fingerprint_hash: z.string().optional(),
});

const RecoverBody = z.object({
  mnemonic: z.string().min(10), // 24 词最少 ~95 字符
  device_fingerprint_hash: z.string().optional(),
});

const RefreshBody = z.object({
  refresh_token: z.string().min(20),
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

// ─── 简化模式 · 账号名+密码 ───────────────────────────────
const RegisterSimpleBody = z.object({
  user_type: z.enum(['customer', 'therapist']),
  user_handle: z.string().min(3).max(16).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(32),
  invite_code: z.string().min(4).max(12).optional(),
  locale: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']).optional(),
  device_fingerprint_hash: z.string().optional(),
});

const LoginSimpleBody = z.object({
  user_handle: z.string().min(3).max(16),
  password: z.string().min(8).max(32),
  device_fingerprint_hash: z.string().optional(),
});

authRoutes.post('/register-simple', zValidator('json', RegisterSimpleBody), async (c) => {
  const body = c.req.valid('json');
  const ctx = buildCtx();
  const ipHash = await hashOptional(clientIp(c));
  const result = await registerSimple(ctx, {
    userType: body.user_type,
    userHandle: body.user_handle,
    password: body.password,
    inviteCode: body.invite_code,
    locale: body.locale,
    ipHash,
    deviceFingerprintHash: body.device_fingerprint_hash,
    userAgent: c.req.header('user-agent'),
  });
  return c.json({
    data: {
      user: { id: result.user.id, userType: result.user.userType, userHandle: result.user.userHandle, displayName: result.user.displayName },
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_at: result.expiresAt,
    },
  });
});

authRoutes.post('/login-simple', zValidator('json', LoginSimpleBody), async (c) => {
  const body = c.req.valid('json');
  const ctx = buildCtx();
  const ipHash = await hashOptional(clientIp(c));
  const result = await loginSimple(ctx, {
    userHandle: body.user_handle,
    password: body.password,
    ipHash,
    userAgent: c.req.header('user-agent'),
    deviceFingerprintHash: body.device_fingerprint_hash,
  });
  return c.json({
    data: {
      user: { id: result.user.id, userType: result.user.userType, userHandle: result.user.userHandle, displayName: result.user.displayName },
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

authRoutes.post('/refresh', zValidator('json', RefreshBody), async (c) => {
  const body = c.req.valid('json');
  const ctx = buildCtx();
  const ipHash = await hashOptional(clientIp(c));

  const { tokens } = await refresh(ctx, {
    refreshToken: body.refresh_token,
    ipHash,
    deviceFingerprintHash: body.device_fingerprint_hash,
    userAgent: c.req.header('user-agent'),
  });

  return c.json({
    data: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
    },
  });
});
