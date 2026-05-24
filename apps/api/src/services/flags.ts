/**
 * Feature Flag 服务 · Phase 6.1
 *
 * 评估顺序：
 * 1. flag.enabled === 0 → 直接 false
 * 2. 用户 override 命中 → 返回 override.enabled
 * 3. user_type / locale / city targeting 命中 → true
 * 4. rolloutBps 散列分桶 → user_id sha256 % 10000 < rolloutBps
 * 5. defaultEnabled
 */

import { and, eq } from 'drizzle-orm';
import {
  Database,
  featureFlags,
  featureFlagUserOverrides,
  users,
  type FeatureFlag,
} from '@loverush/db';

export interface FlagContext {
  db: Database;
}

export interface EvalContext {
  userId?: string;
  userType?: 'customer' | 'therapist';
  locale?: string;
  city?: string;
  appVersion?: string;
}

// ──────────────── 散列分桶 ────────────────

export async function bucket(userId: string, flagKey: string): Promise<number> {
  const buf = new TextEncoder().encode(`${flagKey}:${userId}`);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const view = new DataView(hash);
  // 取前 4 字节
  return view.getUint32(0, false) % 10000;
}

// ──────────────── 评估 ────────────────

export async function isEnabled(
  ctx: FlagContext,
  flagKey: string,
  evalCtx: EvalContext,
): Promise<boolean> {
  const flag = await ctx.db.query.featureFlags.findFirst({ where: eq(featureFlags.key, flagKey) });
  if (!flag) return false;
  if (!flag.enabled) return false;

  // 1. user override
  if (evalCtx.userId) {
    const ov = await ctx.db.query.featureFlagUserOverrides.findFirst({
      where: and(eq(featureFlagUserOverrides.flagKey, flagKey), eq(featureFlagUserOverrides.userId, evalCtx.userId)),
    });
    if (ov) return ov.enabled === 1;
  }

  // 2. targeting
  if (matchTargeting(flag, evalCtx)) return true;

  // 3. rolloutBps 分桶
  if (evalCtx.userId && flag.rolloutBps > 0) {
    const b = await bucket(evalCtx.userId, flagKey);
    if (b < flag.rolloutBps) return true;
  }

  // 4. default
  return flag.defaultEnabled === 1;
}

export function matchTargeting(flag: FeatureFlag, ctx: EvalContext): boolean {
  if (flag.targetUserType && ctx.userType !== flag.targetUserType) return false;

  let hadAnyMatchRule = false;

  if (flag.targetLocales && flag.targetLocales.length) {
    hadAnyMatchRule = true;
    if (!ctx.locale || !flag.targetLocales.includes(ctx.locale)) return false;
  }
  if (flag.targetCities && flag.targetCities.length) {
    hadAnyMatchRule = true;
    if (!ctx.city || !flag.targetCities.includes(ctx.city)) return false;
  }
  if (flag.targetMinAppVersion && ctx.appVersion) {
    hadAnyMatchRule = true;
    if (semverLt(ctx.appVersion, flag.targetMinAppVersion)) return false;
  }

  // 至少一条 targeting 规则全部通过才算命中
  return hadAnyMatchRule || Boolean(flag.targetUserType);
}

export function semverLt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

/** 批量评估（用于客户端首页"我能用哪些 flag"） */
export async function evaluateAllForUser(
  ctx: FlagContext,
  evalCtx: EvalContext,
): Promise<Record<string, boolean>> {
  const flags = await ctx.db.query.featureFlags.findMany({ where: eq(featureFlags.enabled, 1) });
  const result: Record<string, boolean> = {};
  for (const f of flags) {
    result[f.key] = await isEnabled(ctx, f.key, evalCtx);
  }
  return result;
}

// ──────────────── Admin 管理 ────────────────

export interface UpsertArgs {
  key: string;
  description?: string;
  defaultEnabled?: boolean;
  rolloutBps?: number;
  targetUserType?: 'customer' | 'therapist' | null;
  targetLocales?: string[];
  targetCities?: string[];
  targetMinAppVersion?: string;
  enabled?: boolean;
}

export async function upsert(ctx: FlagContext, args: UpsertArgs): Promise<FeatureFlag> {
  const toIntBool = (v?: boolean) => (v === undefined ? undefined : v ? 1 : 0);
  const data = {
    description: args.description,
    defaultEnabled: toIntBool(args.defaultEnabled),
    rolloutBps: args.rolloutBps,
    targetUserType: args.targetUserType,
    targetLocales: args.targetLocales,
    targetCities: args.targetCities,
    targetMinAppVersion: args.targetMinAppVersion,
    enabled: toIntBool(args.enabled),
    updatedAt: new Date(),
  };
  const cleaned: Record<string, unknown> = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  );

  const [row] = await ctx.db
    .insert(featureFlags)
    .values({ key: args.key, ...cleaned })
    .onConflictDoUpdate({ target: featureFlags.key, set: cleaned })
    .returning();
  return row!;
}

export async function setOverride(
  ctx: FlagContext,
  args: { flagKey: string; userId: string; enabled: boolean; reason?: string },
): Promise<void> {
  await ctx.db
    .insert(featureFlagUserOverrides)
    .values({
      flagKey: args.flagKey,
      userId: args.userId,
      enabled: args.enabled ? 1 : 0,
      reason: args.reason,
    })
    .onConflictDoUpdate({
      target: [featureFlagUserOverrides.flagKey, featureFlagUserOverrides.userId],
      set: { enabled: args.enabled ? 1 : 0, reason: args.reason },
    });
}

export async function removeOverride(
  ctx: FlagContext,
  args: { flagKey: string; userId: string },
): Promise<void> {
  await ctx.db
    .delete(featureFlagUserOverrides)
    .where(
      and(
        eq(featureFlagUserOverrides.flagKey, args.flagKey),
        eq(featureFlagUserOverrides.userId, args.userId),
      ),
    );
}

export async function buildEvalContext(ctx: FlagContext, userId: string): Promise<EvalContext> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) return { userId };
  return { userId, userType: u.userType, locale: u.locale };
}
