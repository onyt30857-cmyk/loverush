/**
 * 审核服务 · M11 入驻审核 + M02 媒体审核
 *
 * 审核员从待审队列拉取工单，对每条做 approve / reject。
 * 审批通过 → 同步更新被审对象（媒体公开 / 技师 verification_status）
 */

import { eq, and, asc, desc, sql } from 'drizzle-orm';
import {
  Database,
  contentAuditRecords,
  mediaAssets,
  therapists,
  type ContentAuditRecord,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface ModerationContext {
  db: Database;
}

export interface QueueQuery {
  status?: 'pending' | 'approved' | 'rejected';
  targetType?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditQueue(
  ctx: ModerationContext,
  q: QueueQuery,
): Promise<ContentAuditRecord[]> {
  const conds = [];
  if (q.status) conds.push(eq(contentAuditRecords.status, q.status));
  if (q.targetType) conds.push(eq(contentAuditRecords.targetType, q.targetType));

  const rows = await ctx.db.query.contentAuditRecords.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(contentAuditRecords.priority), asc(contentAuditRecords.submittedAt)],
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  });
  return rows;
}

export async function approveAudit(
  ctx: ModerationContext,
  args: { auditId: string; auditorUserId: string },
): Promise<ContentAuditRecord> {
  const audit = await ctx.db.query.contentAuditRecords.findFirst({
    where: eq(contentAuditRecords.id, args.auditId),
  });
  if (!audit) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'audit not found');
  if (audit.status !== 'pending') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, `audit already ${audit.status}`);
  }

  const [updated] = await ctx.db
    .update(contentAuditRecords)
    .set({
      status: 'approved',
      decision: 'approve',
      auditorUserId: args.auditorUserId,
      decidedAt: new Date(),
    })
    .where(eq(contentAuditRecords.id, args.auditId))
    .returning();

  if (!updated) throw HttpError.internal('audit update failed');

  // 同步被审对象的状态
  await applyApprovalSideEffect(ctx, updated);

  return updated;
}

export async function rejectAudit(
  ctx: ModerationContext,
  args: { auditId: string; auditorUserId: string; reason: string; category?: string },
): Promise<ContentAuditRecord> {
  const audit = await ctx.db.query.contentAuditRecords.findFirst({
    where: eq(contentAuditRecords.id, args.auditId),
  });
  if (!audit) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'audit not found');
  if (audit.status !== 'pending') {
    throw HttpError.conflict(ErrorCode.E0001_INVALID_PARAM, `audit already ${audit.status}`);
  }

  const [updated] = await ctx.db
    .update(contentAuditRecords)
    .set({
      status: 'rejected',
      decision: 'reject',
      rejectReason: args.reason,
      rejectCategory: args.category,
      auditorUserId: args.auditorUserId,
      decidedAt: new Date(),
    })
    .where(eq(contentAuditRecords.id, args.auditId))
    .returning();

  if (!updated) throw HttpError.internal('audit update failed');

  // 同步：媒体被拒 → audit_status=rejected，软删
  if (audit.targetType === 'media' && audit.targetId) {
    await ctx.db
      .update(mediaAssets)
      .set({ auditStatus: 'rejected', deletedAt: new Date() })
      .where(eq(mediaAssets.id, audit.targetId));
  }

  return updated;
}

async function applyApprovalSideEffect(ctx: ModerationContext, audit: ContentAuditRecord) {
  if (audit.targetType === 'media' && audit.targetId) {
    await ctx.db
      .update(mediaAssets)
      .set({ auditStatus: 'approved', auditedAt: new Date() })
      .where(eq(mediaAssets.id, audit.targetId));

    // 若是 liveness 通过 → 技师真人核验状态升级
    const media = await ctx.db.query.mediaAssets.findFirst({
      where: eq(mediaAssets.id, audit.targetId),
    });
    if (media?.purpose === 'liveness') {
      await ctx.db
        .update(therapists)
        .set({
          verificationStatus: 'passed',
          verifiedAt: new Date(),
          realnessCheckLastAt: new Date(),
        })
        .where(eq(therapists.userId, audit.targetUserId));
    }
  } else if (audit.targetType === 'profile') {
    await ctx.db
      .update(therapists)
      .set({ verificationStatus: 'passed', verifiedAt: new Date() })
      .where(eq(therapists.userId, audit.targetUserId));
  }
}

/** 主动提交 profile 进入审核（技师在编辑完档案后调用） */
export async function submitProfileForReview(
  ctx: ModerationContext,
  args: { therapistUserId: string; snapshot: Record<string, unknown> },
): Promise<ContentAuditRecord> {
  const [row] = await ctx.db
    .insert(contentAuditRecords)
    .values({
      targetType: 'profile',
      targetUserId: args.therapistUserId,
      snapshot: args.snapshot,
      status: 'pending',
      priority: 50,
      slaDeadlineAt: new Date(Date.now() + 24 * 3600 * 1000),
    })
    .returning();

  if (!row) throw HttpError.internal('audit submit failed');

  await ctx.db
    .update(therapists)
    .set({ verificationStatus: 'in_review' })
    .where(eq(therapists.userId, args.therapistUserId));

  return row;
}

/**
 * 真人核验队列 · admin 直接看 therapists 表(不走 audit 工单)
 *
 * 队列定义:verification_status ∈ {pending, in_review} → 待审
 * 用 raw SQL JOIN users 拿 display_name + email,避免 N+1
 */
export interface VerificationRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  verification_status: 'pending' | 'in_review' | 'passed' | 'failed';
  liveness_video_url: string | null;
  short_video_url: string | null;
  nationality: string | null;
  service_city: string | null;
  service_area: string | null;
  realness_check_last_at: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface VerificationQueueQuery {
  status?: 'pending' | 'in_review' | 'passed' | 'failed' | 'all';
  limit?: number;
  offset?: number;
}

export async function listVerificationQueue(
  ctx: ModerationContext,
  q: VerificationQueueQuery,
): Promise<VerificationRow[]> {
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const status = q.status ?? 'pending';

  // 默认只看 pending+in_review,显式传 all 时不过滤
  const whereSql =
    status === 'all'
      ? sql`1=1`
      : status === 'pending'
        ? sql`t.verification_status IN ('pending','in_review')`
        : sql`t.verification_status = ${status}`;

  const rows = (await ctx.db.execute(sql`
    SELECT
      t.user_id,
      t.verification_status,
      t.liveness_video_url,
      t.short_video_url,
      t.nationality,
      t.service_city,
      t.service_area,
      t.realness_check_last_at,
      t.verified_at,
      t.created_at,
      u.display_name,
      u.email
    FROM therapists t
    JOIN users u ON u.id = t.user_id
    WHERE ${whereSql}
    ORDER BY
      CASE t.verification_status
        WHEN 'in_review' THEN 0
        WHEN 'pending'   THEN 1
        WHEN 'failed'    THEN 2
        WHEN 'passed'    THEN 3
      END,
      t.created_at ASC
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as VerificationRow[];

  return rows;
}

/**
 * 审核员对 therapist 核验直接裁决(approve / reject)
 *
 * - approve → verification_status=passed + verified_at + realness_check_last_at
 * - reject  → verification_status=failed (技师可重新提交)
 * - 同步收口该用户所有 pending 的 profile audit 工单(避免双轨残留)
 */
export async function decideVerification(
  ctx: ModerationContext,
  args: {
    therapistUserId: string;
    decision: 'approve' | 'reject';
    auditorUserId: string;
    reason?: string;
  },
): Promise<{ therapistUserId: string; verificationStatus: 'passed' | 'failed' }> {
  const therapist = await ctx.db.query.therapists.findFirst({
    where: eq(therapists.userId, args.therapistUserId),
  });
  if (!therapist) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  }

  const now = new Date();
  if (args.decision === 'approve') {
    await ctx.db
      .update(therapists)
      .set({
        verificationStatus: 'passed',
        verifiedAt: now,
        realnessCheckLastAt: now,
      })
      .where(eq(therapists.userId, args.therapistUserId));

    // 同步关闭该用户残留的 pending profile audit
    await ctx.db
      .update(contentAuditRecords)
      .set({
        status: 'approved',
        decision: 'approve',
        auditorUserId: args.auditorUserId,
        decidedAt: now,
      })
      .where(
        and(
          eq(contentAuditRecords.targetUserId, args.therapistUserId),
          eq(contentAuditRecords.targetType, 'profile'),
          eq(contentAuditRecords.status, 'pending'),
        ),
      );

    return { therapistUserId: args.therapistUserId, verificationStatus: 'passed' };
  }

  // reject
  await ctx.db
    .update(therapists)
    .set({ verificationStatus: 'failed' })
    .where(eq(therapists.userId, args.therapistUserId));

  await ctx.db
    .update(contentAuditRecords)
    .set({
      status: 'rejected',
      decision: 'reject',
      rejectReason: args.reason ?? '真人核验未通过',
      auditorUserId: args.auditorUserId,
      decidedAt: now,
    })
    .where(
      and(
        eq(contentAuditRecords.targetUserId, args.therapistUserId),
        eq(contentAuditRecords.targetType, 'profile'),
        eq(contentAuditRecords.status, 'pending'),
      ),
    );

  return { therapistUserId: args.therapistUserId, verificationStatus: 'failed' };
}
