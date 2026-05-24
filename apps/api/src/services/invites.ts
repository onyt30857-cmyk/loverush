/**
 * 邀请码体系 · M10
 *
 * 5 类码：
 * - T 技师邀请客户码
 * - A 区域大使码（管理员发）
 * - U 老客互邀客户码
 * - O 平台官方码（管理员发）
 * - R 技师推荐技师码（核心增长 · 阶梯 3-10%）
 *
 * R 码阶梯：
 *   L1 = 0-4 活跃推荐 → 3%
 *   L2 = 5-19            → 5%
 *   L3 = 20-49           → 7%
 *   L4 = 50+             → 10%
 *
 * 两级关系上限（防传销）
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  Database,
  inviteCodes,
  inviteCodeUsage,
  inviteRelationships,
  rCodeLevels,
  rCodeMilestones,
  users,
  therapistEarnings,
  type InviteRelationship,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface InviteContext {
  db: Database;
}

type Kind = 'T' | 'A' | 'U' | 'O' | 'R';

const R_LEVEL_THRESHOLDS: Array<{ level: number; minActive: number; bps: number }> = [
  { level: 1, minActive: 0, bps: 300 },
  { level: 2, minActive: 5, bps: 500 },
  { level: 3, minActive: 20, bps: 700 },
  { level: 4, minActive: 50, bps: 1000 },
];

function genCode(prefix: Kind): string {
  return `${prefix}-${nanoid(10).toUpperCase()}`;
}

// ──────────────── 用户自助生成 ────────────────

const SELF_GENERATE_ALLOWED: Record<'customer' | 'therapist', Kind[]> = {
  customer: ['U'],     // 客户能生成的：U 老客互邀
  therapist: ['T', 'R'], // 技师能生成的：T 邀客户 + R 推荐技师
};

export async function generateCode(
  ctx: InviteContext,
  args: { issuerUserId: string; kind: Kind; maxUses?: number; expiresInDays?: number; note?: string },
): Promise<{ code: string; codeId: string }> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, args.issuerUserId) });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  const allowed = SELF_GENERATE_ALLOWED[u.userType] ?? [];
  if (!allowed.includes(args.kind)) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, `${u.userType} cannot generate ${args.kind}`);
  }

  const targetUserType =
    args.kind === 'T' || args.kind === 'U'
      ? 'customer'
      : args.kind === 'R'
      ? 'therapist'
      : null;

  const expiresAt = args.expiresInDays
    ? new Date(Date.now() + args.expiresInDays * 24 * 3600 * 1000)
    : null;

  const code = genCode(args.kind);
  const [row] = await ctx.db
    .insert(inviteCodes)
    .values({
      code,
      kind: args.kind,
      targetUserType,
      issuerUserId: args.issuerUserId,
      issuerNote: args.note,
      maxUses: args.maxUses ?? 50,
      expiresAt,
    })
    .returning();

  if (!row) throw HttpError.internal('invite code insert failed');
  return { code: row.code, codeId: row.id };
}

// ──────────────── 使用邀请码（注册时调用） ────────────────

export async function recordRelationship(
  ctx: InviteContext,
  args: { codeId: string; inviteeUserId: string; relationKind: Kind },
): Promise<InviteRelationship | null> {
  const code = await ctx.db.query.inviteCodes.findFirst({ where: eq(inviteCodes.id, args.codeId) });
  if (!code || !code.issuerUserId) return null;

  // 一级关系
  const [direct] = await ctx.db
    .insert(inviteRelationships)
    .values({
      inviterUserId: code.issuerUserId,
      inviteeUserId: args.inviteeUserId,
      inviteCodeId: code.id,
      level: 1,
      rootInviterUserId: code.issuerUserId,
      relationKind: args.relationKind,
    })
    .onConflictDoNothing()
    .returning();

  // 二级关系（如果一级 inviter 自己被人邀请过）
  const grand = await ctx.db.query.inviteRelationships.findFirst({
    where: and(
      eq(inviteRelationships.inviteeUserId, code.issuerUserId),
      eq(inviteRelationships.level, 1),
    ),
  });
  if (grand) {
    await ctx.db
      .insert(inviteRelationships)
      .values({
        inviterUserId: grand.inviterUserId,
        inviteeUserId: args.inviteeUserId,
        inviteCodeId: code.id,
        level: 2,
        rootInviterUserId: grand.rootInviterUserId ?? grand.inviterUserId,
        relationKind: grand.relationKind,
      })
      .onConflictDoNothing();
  }

  // R 码：技师推荐技师 → 更新 R 码等级
  if (args.relationKind === 'R') {
    await bumpRCodeOnNewInvitee(ctx, code.issuerUserId);
  }

  return direct ?? null;
}

async function bumpRCodeOnNewInvitee(ctx: InviteContext, therapistUserId: string): Promise<void> {
  const existing = await ctx.db.query.rCodeLevels.findFirst({
    where: eq(rCodeLevels.therapistUserId, therapistUserId),
  });

  const newInvitedCount = (existing?.invitedTherapistCount ?? 0) + 1;

  if (!existing) {
    await ctx.db.insert(rCodeLevels).values({
      therapistUserId,
      invitedTherapistCount: newInvitedCount,
    });
    return;
  }

  await ctx.db
    .update(rCodeLevels)
    .set({
      invitedTherapistCount: newInvitedCount,
      updatedAt: new Date(),
    })
    .where(eq(rCodeLevels.therapistUserId, therapistUserId));
}

/** 被邀请技师首单完成 → 升 active 计数 → 可能晋级 */
export async function onInviteeFirstOrder(
  ctx: InviteContext,
  therapistUserIdOfInvitee: string,
): Promise<void> {
  // 找 R 码上游
  const rel = await ctx.db.query.inviteRelationships.findFirst({
    where: and(
      eq(inviteRelationships.inviteeUserId, therapistUserIdOfInvitee),
      eq(inviteRelationships.relationKind, 'R'),
      eq(inviteRelationships.level, 1),
    ),
  });
  if (!rel) return;

  const upstream = await ctx.db.query.rCodeLevels.findFirst({
    where: eq(rCodeLevels.therapistUserId, rel.inviterUserId),
  });
  if (!upstream) return;

  const newActive = upstream.activeTherapistCount + 1;
  const tier = computeRTier(newActive);

  if (tier.level !== upstream.level) {
    await ctx.db.insert(rCodeMilestones).values({
      therapistUserId: rel.inviterUserId,
      eventType: 'promotion',
      fromLevel: upstream.level,
      toLevel: tier.level,
      fromCommissionBps: upstream.commissionBps,
      toCommissionBps: tier.bps,
      triggerJson: { activeCount: newActive },
    });
  }

  await ctx.db
    .update(rCodeLevels)
    .set({
      activeTherapistCount: newActive,
      level: tier.level,
      commissionBps: tier.bps,
      lastPromotedAt: tier.level !== upstream.level ? new Date() : upstream.lastPromotedAt,
      updatedAt: new Date(),
    })
    .where(eq(rCodeLevels.therapistUserId, rel.inviterUserId));
}

function computeRTier(activeCount: number): { level: number; bps: number } {
  let result = R_LEVEL_THRESHOLDS[0]!;
  for (const t of R_LEVEL_THRESHOLDS) {
    if (activeCount >= t.minActive) result = t;
  }
  return { level: result.level, bps: result.bps };
}

/** 被邀请技师产生收益 → 给上游 R 码持有人分成（现金） */
export async function awardRCommission(
  ctx: InviteContext,
  args: { childTherapistUserId: string; sourceAmountCents: number; reason: string },
): Promise<{ paidCents: number; toUserId: string } | null> {
  const rel = await ctx.db.query.inviteRelationships.findFirst({
    where: and(
      eq(inviteRelationships.inviteeUserId, args.childTherapistUserId),
      eq(inviteRelationships.relationKind, 'R'),
      eq(inviteRelationships.level, 1),
    ),
  });
  if (!rel) return null;

  const tier = await ctx.db.query.rCodeLevels.findFirst({
    where: eq(rCodeLevels.therapistUserId, rel.inviterUserId),
  });
  const bps = tier?.commissionBps ?? 300;

  const cents = Math.floor((args.sourceAmountCents * bps) / 10000);
  if (cents <= 0) return null;

  await ctx.db
    .insert(therapistEarnings)
    .values({
      therapistUserId: rel.inviterUserId,
      availableCents: cents,
      inviteRewardsCents: cents,
    })
    .onConflictDoUpdate({
      target: therapistEarnings.therapistUserId,
      set: {
        availableCents: sql`${therapistEarnings.availableCents} + ${cents}`,
        inviteRewardsCents: sql`${therapistEarnings.inviteRewardsCents} + ${cents}`,
        updatedAt: new Date(),
      },
    });

  await ctx.db.insert(rCodeMilestones).values({
    therapistUserId: rel.inviterUserId,
    eventType: 'commission_earned',
    amountCents: cents,
    triggerJson: { reason: args.reason, sourceAmountCents: args.sourceAmountCents, fromUserId: args.childTherapistUserId },
  });

  if (tier) {
    await ctx.db
      .update(rCodeLevels)
      .set({
        totalCommissionEarnedCents: sql`${rCodeLevels.totalCommissionEarnedCents} + ${cents}`,
        updatedAt: new Date(),
      })
      .where(eq(rCodeLevels.therapistUserId, rel.inviterUserId));
  }

  return { paidCents: cents, toUserId: rel.inviterUserId };
}

export async function listMyInvitees(ctx: InviteContext, userId: string): Promise<InviteRelationship[]> {
  return ctx.db.query.inviteRelationships.findMany({
    where: eq(inviteRelationships.inviterUserId, userId),
  });
}

export async function listMyInviteCodes(ctx: InviteContext, userId: string) {
  return ctx.db.query.inviteCodes.findMany({
    where: and(eq(inviteCodes.issuerUserId, userId), isNull(inviteCodes.disabledAt)),
  });
}

export async function getMyRCodeStatus(ctx: InviteContext, userId: string) {
  return ctx.db.query.rCodeLevels.findFirst({ where: eq(rCodeLevels.therapistUserId, userId) });
}
