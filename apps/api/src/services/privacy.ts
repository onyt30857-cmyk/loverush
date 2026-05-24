/**
 * 隐私模式服务 · M15（H5 适配版）
 *
 * - setPin / verifyPin / clearPin
 * - PIN 散列：PBKDF2-SHA256 + 随机 salt（16B）+ 200_000 iterations
 *   格式：`v1$<salt-base64>$<hash-base64>`
 * - 防爆破：连续失败 N 次进入 lockedUntilAt（指数退避）
 *
 * 不支持（H5 限制）：
 * - 应用图标 / 名称动态切换（撤）
 * - 原生 FLAG_SECURE 截屏阻断（撤 · 走 CSS+JS 兜底）
 */

import { eq } from 'drizzle-orm';
import {
  Database,
  privacySettings,
  pinAttempts,
  type PrivacySetting,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface PrivacyContext {
  db: Database;
}

const PBKDF2_ITER = 200_000;
const PIN_FAIL_LOCK_THRESHOLD = 5;
const PIN_FAIL_LOCK_SECONDS = [0, 0, 0, 30, 120, 600, 1800]; // 第 N 次失败后锁定秒数

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

function b64decode(s: string): Uint8Array {
  const raw = atob(s);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function pbkdf2(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt);
  return `v1$${b64encode(salt)}$${b64encode(hash)}`;
}

async function verifyHash(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const salt = b64decode(parts[1]!);
  const expected = b64decode(parts[2]!);
  const computed = await pbkdf2(pin, salt);
  if (computed.byteLength !== expected.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < computed.byteLength; i++) diff |= computed[i]! ^ expected[i]!;
  return diff === 0;
}

// ──────────────── 服务 ────────────────

export async function getOrCreate(ctx: PrivacyContext, userId: string): Promise<PrivacySetting> {
  const existing = await ctx.db.query.privacySettings.findFirst({
    where: eq(privacySettings.userId, userId),
  });
  if (existing) return existing;
  const [row] = await ctx.db.insert(privacySettings).values({ userId }).returning();
  return row!;
}

export async function setPin(
  ctx: PrivacyContext,
  args: { userId: string; newPin: string; currentPin?: string; ipHash?: string; deviceFingerprintHash?: string },
): Promise<PrivacySetting> {
  if (!/^\d{4,8}$/.test(args.newPin)) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'PIN must be 4-8 digits');
  }

  const existing = await getOrCreate(ctx, args.userId);

  // 如果已有 PIN，要先验证旧 PIN
  if (existing.pinHash) {
    if (!args.currentPin) {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'current PIN required');
    }
    const ok = await verifyHash(args.currentPin, existing.pinHash);
    await ctx.db.insert(pinAttempts).values({
      userId: args.userId,
      outcome: ok ? 'success' : 'failure',
      ipHash: args.ipHash,
      deviceFingerprintHash: args.deviceFingerprintHash,
    });
    if (!ok) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'current PIN wrong');
  }

  const newHash = await hashPin(args.newPin);
  const [updated] = await ctx.db
    .update(privacySettings)
    .set({ pinHash: newHash, pinSetAt: new Date(), failedAttempts: 0, lockedUntilAt: null, updatedAt: new Date() })
    .where(eq(privacySettings.userId, args.userId))
    .returning();
  return updated!;
}

export async function verifyPin(
  ctx: PrivacyContext,
  args: { userId: string; pin: string; ipHash?: string; deviceFingerprintHash?: string },
): Promise<{ ok: boolean; lockedUntilAt?: Date; remainingAttempts?: number }> {
  const row = await getOrCreate(ctx, args.userId);
  if (!row.pinHash) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'PIN not set');
  }
  if (row.lockedUntilAt && row.lockedUntilAt.getTime() > Date.now()) {
    return { ok: false, lockedUntilAt: row.lockedUntilAt };
  }

  const ok = await verifyHash(args.pin, row.pinHash);

  await ctx.db.insert(pinAttempts).values({
    userId: args.userId,
    outcome: ok ? 'success' : 'failure',
    ipHash: args.ipHash,
    deviceFingerprintHash: args.deviceFingerprintHash,
  });

  if (ok) {
    await ctx.db
      .update(privacySettings)
      .set({ failedAttempts: 0, lockedUntilAt: null, updatedAt: new Date() })
      .where(eq(privacySettings.userId, args.userId));
    return { ok: true };
  }

  const failedNext = row.failedAttempts + 1;
  const lockSec = PIN_FAIL_LOCK_SECONDS[Math.min(failedNext, PIN_FAIL_LOCK_SECONDS.length - 1)] ?? 0;
  const lockedUntil = lockSec > 0 ? new Date(Date.now() + lockSec * 1000) : null;

  await ctx.db
    .update(privacySettings)
    .set({ failedAttempts: failedNext, lockedUntilAt: lockedUntil, updatedAt: new Date() })
    .where(eq(privacySettings.userId, args.userId));

  return {
    ok: false,
    lockedUntilAt: lockedUntil ?? undefined,
    remainingAttempts: Math.max(0, PIN_FAIL_LOCK_THRESHOLD - failedNext),
  };
}

export async function clearPin(
  ctx: PrivacyContext,
  args: { userId: string; currentPin: string },
): Promise<void> {
  const row = await getOrCreate(ctx, args.userId);
  if (!row.pinHash) return;
  const ok = await verifyHash(args.currentPin, row.pinHash);
  if (!ok) throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'PIN wrong');

  await ctx.db
    .update(privacySettings)
    .set({
      pinHash: null,
      pinSetAt: null,
      failedAttempts: 0,
      lockedUntilAt: null,
      privacyModeEnabled: 0,
      updatedAt: new Date(),
    })
    .where(eq(privacySettings.userId, args.userId));
}

export interface SettingsPatch {
  privacyModeEnabled?: boolean;
  decoyEnabled?: boolean;
  decoyType?: 'calculator' | 'notes' | 'weather';
  autoLockSeconds?: number;
  obfuscateNotifications?: boolean;
  panicWipeOnFailedAttempts?: boolean;
  panicWipeThreshold?: number;
}

export async function updateSettings(
  ctx: PrivacyContext,
  args: { userId: string; patch: SettingsPatch },
): Promise<PrivacySetting> {
  await getOrCreate(ctx, args.userId);

  const toIntBool = (v?: boolean) => (v === undefined ? undefined : v ? 1 : 0);
  const data = {
    privacyModeEnabled: toIntBool(args.patch.privacyModeEnabled),
    decoyEnabled: toIntBool(args.patch.decoyEnabled),
    decoyType: args.patch.decoyType,
    autoLockSeconds: args.patch.autoLockSeconds,
    obfuscateNotifications: toIntBool(args.patch.obfuscateNotifications),
    panicWipeOnFailedAttempts: toIntBool(args.patch.panicWipeOnFailedAttempts),
    panicWipeThreshold: args.patch.panicWipeThreshold,
    updatedAt: new Date(),
  };
  const cleaned: Record<string, unknown> = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  );

  const [row] = await ctx.db
    .update(privacySettings)
    .set(cleaned)
    .where(eq(privacySettings.userId, args.userId))
    .returning();
  return row!;
}
