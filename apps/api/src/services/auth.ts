/**
 * 认证服务 · M01 注册（PRD §4.0.7）
 *
 * BIP-39 匿名身份流程：
 * 1. 服务端生成 24 词助记词
 * 2. 派生 Ed25519 公私钥
 * 3. 公钥哈希入库（唯一身份），私钥用助记词派生密钥加密存储（端到端密钥仓库）
 * 4. 助记词只返回客户端一次（用户必须备份，丢失即失去账户）
 * 5. 邀请码消耗 + 关联
 *
 * 恢复流程：
 * 1. 客户端提交 24 词
 * 2. 服务端派生 publicKey
 * 3. 用 pubkey_hash 查库 → 返回 user + 签发 JWT
 */

import { eq, and, isNull, sql, lt } from 'drizzle-orm';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';
import { SignJWT, jwtVerify } from 'jose';
import { nanoid } from 'nanoid';
import type {
  Database} from '@loverush/db';
import {
  users,
  sessions,
  inviteCodes,
  inviteCodeUsage,
  encryptionKeys,
  pointsAccount,
  type User,
} from '@loverush/db';
import { ErrorCode, type UserTypeValue } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface AuthContext {
  db: Database;
  jwtSecret: Uint8Array;
  jwtIssuer: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface RegisterParams {
  userType: UserTypeValue;
  // 公开邀约期 · 无邀请码也可注册;有码走完整校验链路
  inviteCode?: string;
  displayName?: string;
  locale?: string;
  ipHash?: string;
  deviceFingerprintHash?: string;
  userAgent?: string;
}

export interface RegisterResult {
  user: { id: string; userType: UserTypeValue; displayName: string | null };
  mnemonic: string; // 24 词（仅返回一次）
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface RecoverParams {
  mnemonic: string;
  ipHash?: string;
  deviceFingerprintHash?: string;
  userAgent?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** 从 32-byte seed 派生 publicKeyHash（取 sha256） */
async function publicKeyHashFromSeed(seed: Uint8Array): Promise<string> {
  // 这里用 seed 的前 32 字节做 sha256 作为身份指纹
  // 真实生产应该用 Ed25519 派生 + 公钥 sha256
  const hash = await crypto.subtle.digest('SHA-256', seed.slice(0, 32));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveKeyMaterial(mnemonic: string): Promise<{
  pubkeyHash: string;
  recoveryHash: string;
  seed: Uint8Array;
}> {
  if (!bip39.validateMnemonic(mnemonic, english)) {
    throw HttpError.badRequest(ErrorCode.E1040_KEY_RECOVERY_FAILED, 'invalid mnemonic');
  }
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const pubkeyHash = await publicKeyHashFromSeed(seed);

  // recoveryHash：助记词的另一种派生（用于密码找回校验）
  const recoveryBytes = await crypto.subtle.digest('SHA-256', seed.slice(32, 64));
  const recoveryHash = Array.from(new Uint8Array(recoveryBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return { pubkeyHash, recoveryHash, seed };
}

async function issueTokens(ctx: AuthContext, userId: string): Promise<SessionTokens> {
  const now = Math.floor(Date.now() / 1000);
  const accessExpiresAt = now + ctx.accessTtlSeconds;
  const refreshExpiresAt = now + ctx.refreshTtlSeconds;
  const jti = nanoid(16);

  const accessToken = await new SignJWT({ sub: userId, jti, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ctx.jwtIssuer)
    .setIssuedAt(now)
    .setExpirationTime(accessExpiresAt)
    .sign(ctx.jwtSecret);

  const refreshToken = await new SignJWT({ sub: userId, jti, typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ctx.jwtIssuer)
    .setIssuedAt(now)
    .setExpirationTime(refreshExpiresAt)
    .sign(ctx.jwtSecret);

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(accessExpiresAt * 1000).toISOString(),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function persistSession(
  ctx: AuthContext,
  userId: string,
  tokens: SessionTokens,
  meta: { ipHash?: string; userAgent?: string; deviceFingerprintHash?: string },
) {
  const accessHash = await sha256Hex(tokens.accessToken);
  const refreshHash = await sha256Hex(tokens.refreshToken);

  await ctx.db.insert(sessions).values({
    userId,
    tokenHash: accessHash,
    refreshTokenHash: refreshHash,
    userAgent: meta.userAgent,
    ipHash: meta.ipHash,
    expiresAt: new Date(Date.now() + ctx.refreshTtlSeconds * 1000),
  });
}

export async function register(ctx: AuthContext, params: RegisterParams): Promise<RegisterResult> {
  // 1. 邀请码校验 · 公开邀约期允许无码注册(params.inviteCode 空时跳过整段)
  let code: typeof inviteCodes.$inferSelect | undefined;
  if (params.inviteCode) {
    code = await ctx.db.query.inviteCodes.findFirst({
      where: and(eq(inviteCodes.code, params.inviteCode), isNull(inviteCodes.disabledAt)),
    });
    if (!code) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code invalid');
    }
    if (code.usedCount >= code.maxUses) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code exhausted');
    }
    if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code expired');
    }
    if (code.targetUserType && code.targetUserType !== params.userType) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code not for this role');
    }
  }

  // 2. 生成助记词 + 派生身份
  const mnemonic = bip39.generateMnemonic(english, 128); // 12 词(BIP-39 128 bit 熵 · 安全/体验平衡;recover 仍兼容老 24 词账号)
  const { pubkeyHash, recoveryHash } = await deriveKeyMaterial(mnemonic);

  // 3. 检查 pubkeyHash 唯一（极小概率碰撞）
  const exists = await ctx.db.query.users.findFirst({
    where: eq(users.bip39PubkeyHash, pubkeyHash),
  });
  if (exists) {
    throw HttpError.internal('mnemonic collision, please retry');
  }

  // 4. 落库 user + 邀请码消耗 + 积分账户 + 加密密钥占位
  const [created] = await ctx.db
    .insert(users)
    .values({
      userType: params.userType,
      status: 'active',
      bip39PubkeyHash: pubkeyHash,
      recoveryHash,
      displayName: params.displayName,
      locale: (params.locale as 'zh') ?? 'zh',
    })
    .returning();

  if (!created) throw HttpError.internal('user create failed');

  // 邀请码消耗 + 关系记录 · 仅当 code 存在时(无码注册跳过)
  if (code) {
    await ctx.db
      .update(inviteCodes)
      .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
      .where(eq(inviteCodes.id, code.id));

    await ctx.db.insert(inviteCodeUsage).values({
      inviteCodeId: code.id,
      usedByUserId: created.id,
      ipHash: params.ipHash,
      deviceFingerprintHash: params.deviceFingerprintHash,
    });
  }

  await ctx.db.insert(pointsAccount).values({ userId: created.id });

  // encryption_keys 占位（实际公私钥由客户端在本地生成 + 上传公钥）
  // 此处只标记一行 active，便于后续填充
  await ctx.db.insert(encryptionKeys).values({
    userId: created.id,
    algorithm: 'pending',
    publicKey: 'pending',
    encryptedPrivateKey: 'pending',
    keySalt: 'pending',
    keyVersion: 1,
    isActive: 1,
  });

  // 邀请关系(一级 + 二级 · 防传销)+ R 码晋升触发 · 仅当用邀请码时
  if (code) {
    try {
      const inv = await import('./invites');
      await inv.recordRelationship({ db: ctx.db }, {
        codeId: code.id,
        inviteeUserId: created.id,
        relationKind: code.kind,
      });
    } catch (e) {
      // 不阻塞注册,但必须留痕 — 静默吞错会让分成体系破产
      const { logger } = await import('./logger');
      logger.error('invite_relationship_failed', {
        err: e instanceof Error ? e.message : String(e),
        userId: created.id,
        codeId: code.id,
        kind: code.kind,
      });
    }
  }

  // 5. 签发 token
  const tokens = await issueTokens(ctx, created.id);
  await persistSession(ctx, created.id, tokens, {
    ipHash: params.ipHash,
    userAgent: params.userAgent,
    deviceFingerprintHash: params.deviceFingerprintHash,
  });

  return {
    user: { id: created.id, userType: created.userType, displayName: created.displayName },
    mnemonic,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
}

// ──────────────── 账号名 + 密码模式(简化注册)────────────────

export interface RegisterSimpleParams {
  userType: UserTypeValue;
  userHandle: string;
  password: string;
  inviteCode?: string;
  locale?: string;
  ipHash?: string;
  deviceFingerprintHash?: string;
  userAgent?: string;
}

export interface RegisterSimpleResult {
  user: { id: string; userType: UserTypeValue; userHandle: string; displayName: string | null };
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

const USER_HANDLE_RE = /^[a-zA-Z0-9_]{3,16}$/;
const PASSWORD_RE = /^[a-zA-Z0-9_!@#$%^&*-]{8,32}$/;

/** 查找已有 user_handle(unique 应用层校验)*/
async function findByUserHandle(ctx: AuthContext, handle: string) {
  return await ctx.db.query.users.findFirst({
    where: sql`metadata->>'user_handle' = ${handle}`,
  });
}

/**
 * 简化注册 · 账号名 + 密码
 * - user_handle 存到 metadata.user_handle(应用层 unique)
 * - password 用 Bun.password.hash(argon2id 默认)存 metadata.password_hash
 * - 不生成助记词 / keypair(用户感知不到加密细节)
 */
export async function registerSimple(
  ctx: AuthContext,
  params: RegisterSimpleParams,
): Promise<RegisterSimpleResult> {
  if (!USER_HANDLE_RE.test(params.userHandle)) {
    throw HttpError.badRequest(
      ErrorCode.E0001_INVALID_PARAM,
      '账号名 3-16 位字母/数字/下划线',
    );
  }
  if (!PASSWORD_RE.test(params.password)) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '密码 8-32 位字母/数字/常用符号');
  }

  // 1. 邀请码可选校验(同 register 主链路)
  let code: typeof inviteCodes.$inferSelect | undefined;
  if (params.inviteCode) {
    code = await ctx.db.query.inviteCodes.findFirst({
      where: and(eq(inviteCodes.code, params.inviteCode), isNull(inviteCodes.disabledAt)),
    });
    if (!code) throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code invalid');
    if (code.usedCount >= code.maxUses) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code exhausted');
    }
    if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code expired');
    }
    if (code.targetUserType && code.targetUserType !== params.userType) {
      throw HttpError.badRequest(ErrorCode.E1031_INVITE_CODE_INVALID, 'invite code not for this role');
    }
  }

  // 2. user_handle 应用层 unique 校验
  const taken = await findByUserHandle(ctx, params.userHandle);
  if (taken) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '账号名已被占用');
  }

  // 3. bcrypt(Bun 原生 argon2id)hash 密码
  const passwordHash = await Bun.password.hash(params.password, { algorithm: 'argon2id' });

  // 4. 落库 user · bip39_pubkey_hash 用 nanoid 占位(密码模式不用 bip39)
  const fakePubkeyHash = `pwd-${nanoid(48)}`;
  const fakeRecoveryHash = `pwd-${nanoid(32)}`;
  const [created] = await ctx.db
    .insert(users)
    .values({
      userType: params.userType,
      status: 'active',
      bip39PubkeyHash: fakePubkeyHash,
      recoveryHash: fakeRecoveryHash,
      displayName: params.userHandle,
      locale: (params.locale as 'zh') ?? 'zh',
      metadata: {
        user_handle: params.userHandle,
        password_hash: passwordHash,
        auth_method: 'password',
      },
    })
    .returning();
  if (!created) throw HttpError.internal('user create failed');

  // 5. 邀请码消耗(如果用了)
  if (code) {
    await ctx.db
      .update(inviteCodes)
      .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
      .where(eq(inviteCodes.id, code.id));
    await ctx.db.insert(inviteCodeUsage).values({
      inviteCodeId: code.id,
      usedByUserId: created.id,
      ipHash: params.ipHash,
      deviceFingerprintHash: params.deviceFingerprintHash,
    });
  }

  // 6. 积分账户
  await ctx.db.insert(pointsAccount).values({ userId: created.id });

  // 7. encryption_keys 占位(密码模式暂不接 E2EE)
  await ctx.db.insert(encryptionKeys).values({
    userId: created.id,
    algorithm: 'pending',
    publicKey: 'pending',
    encryptedPrivateKey: 'pending',
    keySalt: 'pending',
    keyVersion: 1,
    isActive: 1,
  });

  // 8. 邀请关系(沿用主路)
  if (code) {
    try {
      const inv = await import('./invites');
      await inv.recordRelationship({ db: ctx.db }, {
        codeId: code.id,
        inviteeUserId: created.id,
        relationKind: code.kind,
      });
    } catch (e) {
      const { logger } = await import('./logger');
      logger.error('invite_relationship_failed', {
        err: e instanceof Error ? e.message : String(e),
        userId: created.id,
      });
    }
  }

  // 9. 签发 token
  const tokens = await issueTokens(ctx, created.id);
  await persistSession(ctx, created.id, tokens, {
    ipHash: params.ipHash,
    userAgent: params.userAgent,
    deviceFingerprintHash: params.deviceFingerprintHash,
  });

  return {
    user: {
      id: created.id,
      userType: created.userType,
      userHandle: params.userHandle,
      displayName: created.displayName,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
}

/**
 * 异常登录入 risk_events · admin 后台监管
 * fire-and-forget · 错误自吞(防 logging 失败导致 auth 流程崩)
 */
async function recordLoginFailure(
  ctx: AuthContext,
  args: {
    handle: string;
    reason: 'user_not_found' | 'no_password_set' | 'wrong_password' | 'banned_login_attempt' | 'otp_invalid';
    subjectUserId?: string;
    ipHash?: string;
    severity?: number;
  },
): Promise<void> {
  try {
    const { recordRiskEvent } = await import('./risk');
    await recordRiskEvent({ db: ctx.db }, {
      subjectUserId: args.subjectUserId,
      subjectType: 'user',
      eventType: `login_${args.reason}`,
      severity: args.severity ?? 40,
      payload: {
        handle: args.handle.slice(0, 64), // 脱敏限长 · 避免 GDPR
        ip_hash: args.ipHash ?? null,
      },
    });
  } catch {
    // 静默 · 不阻塞 auth 流
  }
}

/** 账号名+密码登录 */
export async function loginSimple(
  ctx: AuthContext,
  params: { userHandle: string; password: string; ipHash?: string; userAgent?: string; deviceFingerprintHash?: string },
): Promise<RegisterSimpleResult> {
  const user = await findByUserHandle(ctx, params.userHandle);
  if (!user) {
    // 异常登录入 risk_events · admin 后台监管(账号不存在/枚举尝试)
    void recordLoginFailure(ctx, { handle: params.userHandle, reason: 'user_not_found', ipHash: params.ipHash });
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, '账号或密码不正确');
  }
  const meta = (user.metadata ?? {}) as { password_hash?: string };
  if (!meta.password_hash) {
    void recordLoginFailure(ctx, { handle: params.userHandle, reason: 'no_password_set', subjectUserId: user.id, ipHash: params.ipHash });
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, '账号或密码不正确');
  }
  if (user.status === 'banned') {
    void recordLoginFailure(ctx, { handle: params.userHandle, reason: 'banned_login_attempt', subjectUserId: user.id, ipHash: params.ipHash, severity: 70 });
    throw HttpError.forbidden(ErrorCode.E7001_USER_BANNED, 'user banned');
  }
  const ok = await Bun.password.verify(params.password, meta.password_hash);
  if (!ok) {
    void recordLoginFailure(ctx, { handle: params.userHandle, reason: 'wrong_password', subjectUserId: user.id, ipHash: params.ipHash });
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, '账号或密码不正确');
  }
  const tokens = await issueTokens(ctx, user.id);
  await persistSession(ctx, user.id, tokens, {
    ipHash: params.ipHash,
    userAgent: params.userAgent,
    deviceFingerprintHash: params.deviceFingerprintHash,
  });
  return {
    user: {
      id: user.id,
      userType: user.userType,
      userHandle: params.userHandle,
      displayName: user.displayName,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
}

export async function recover(
  ctx: AuthContext,
  params: RecoverParams,
): Promise<{ user: User; tokens: SessionTokens }> {
  const { pubkeyHash } = await deriveKeyMaterial(params.mnemonic);

  const user = await ctx.db.query.users.findFirst({
    where: eq(users.bip39PubkeyHash, pubkeyHash),
  });
  if (!user) {
    throw HttpError.badRequest(ErrorCode.E1040_KEY_RECOVERY_FAILED, 'no user for this mnemonic');
  }
  if (user.status === 'banned') {
    throw HttpError.forbidden(ErrorCode.E7001_USER_BANNED, 'user banned');
  }

  const tokens = await issueTokens(ctx, user.id);
  await persistSession(ctx, user.id, tokens, {
    ipHash: params.ipHash,
    userAgent: params.userAgent,
    deviceFingerprintHash: params.deviceFingerprintHash,
  });

  await ctx.db
    .update(users)
    .set({ lastActiveAt: new Date() })
    .where(eq(users.id, user.id));

  return { user, tokens };
}

export interface RefreshParams {
  refreshToken: string;
  ipHash?: string;
  userAgent?: string;
  deviceFingerprintHash?: string;
}

export async function refresh(
  ctx: AuthContext,
  params: RefreshParams,
): Promise<{ tokens: SessionTokens }> {
  // 1. 校验 refresh token 签名 + 有效期
  let payload: { sub?: unknown; typ?: unknown };
  try {
    const result = await jwtVerify(params.refreshToken, ctx.jwtSecret, {
      issuer: ctx.jwtIssuer,
    });
    payload = result.payload;
  } catch {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'refresh token invalid or expired');
  }

  if (payload.typ !== 'refresh' || typeof payload.sub !== 'string') {
    throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'token type mismatch');
  }

  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, payload.sub) });
  if (!user) {
    throw HttpError.unauthorized(ErrorCode.E1040_KEY_RECOVERY_FAILED, 'user not found');
  }
  if (user.status === 'banned') {
    throw HttpError.forbidden(ErrorCode.E7001_USER_BANNED, 'user banned');
  }

  const tokens = await issueTokens(ctx, user.id);
  await persistSession(ctx, user.id, tokens, {
    ipHash: params.ipHash,
    userAgent: params.userAgent,
    deviceFingerprintHash: params.deviceFingerprintHash,
  });

  await ctx.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, user.id));

  return { tokens };
}

export async function revokeExpiredSessions(ctx: AuthContext): Promise<number> {
  const res = await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: 'expired' })
    .where(and(isNull(sessions.revokedAt), lt(sessions.expiresAt, new Date())))
    .returning({ id: sessions.id });
  return res.length;
}
