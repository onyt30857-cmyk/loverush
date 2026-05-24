/**
 * 审核服务 · M11 入驻审核 + M02 媒体审核
 *
 * 审核员从待审队列拉取工单，对每条做 approve / reject。
 * 审批通过 → 同步更新被审对象（媒体公开 / 技师 verification_status）
 */

import { eq, and, asc, desc } from 'drizzle-orm';
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
