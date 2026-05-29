/**
 * 用户媒体库 · admin · (T1)
 *
 * GET /admin/users/:id/media
 *
 * 按 owner_user_id 拉一个用户(主要是技师,客户也可看)的所有 media_assets:
 *   - 头像 / 短视频 / 语音介绍 / 相册图 / liveness 视频
 *   - 3 档 visibility(public / paid_unlock / platform_only)
 *   - 4 档 auditStatus(pending / approved / rejected)
 *
 * 权限分级:
 *   - admin / auditor:看全部(含 liveness 视频 + private_url)
 *   - cs:看 public + paid_unlock(看不到 liveness / private_url)
 *   - ops:看 metadata(不返 publicUrl / thumbnailUrl)
 *
 * 用途:技师详情页 'media' tab
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { mediaAssets, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

const ListQuery = z.object({
  visibility: z.enum(['public', 'paid_unlock', 'platform_only']).optional(),
  purpose: z.string().max(40).optional(),
  audit_status: z.enum(['pending', 'approved', 'rejected']).optional(),
  // 默认排除软删除,可显式 include
  include_deleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const adminUserMediaRoutes = new Hono();
adminUserMediaRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'auditor', 'ops']));

function canSeeContent(roles: string[]): boolean {
  return roles.some((r) => r === 'admin' || r === 'cs' || r === 'auditor');
}
function canSeeLiveness(roles: string[]): boolean {
  return roles.some((r) => r === 'admin' || r === 'auditor');
}

adminUserMediaRoutes.get('/:id/media', zValidator('query', ListQuery), async (c) => {
  const id = c.req.param('id');
  const q = c.req.valid('query');
  const db = getDb();
  const roles = (c.get('userRoles' as never) as string[] | undefined) ?? [];
  const showContent = canSeeContent(roles);
  const showLiveness = canSeeLiveness(roles);

  // 验证用户存在
  const u = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, displayName: true, userType: true },
  });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  // 构造 where 条件
  const conds = [eq(mediaAssets.ownerUserId, id)];
  if (q.visibility) conds.push(eq(mediaAssets.visibility, q.visibility));
  if (q.purpose) conds.push(eq(mediaAssets.purpose, q.purpose));
  if (q.audit_status) conds.push(eq(mediaAssets.auditStatus, q.audit_status));
  if (!q.include_deleted) conds.push(isNull(mediaAssets.deletedAt));

  // ops 不可看 liveness;cs 也不可看 liveness(只 admin/auditor 可)
  if (!showLiveness) {
    conds.push(sql`${mediaAssets.purpose} != 'liveness'`);
  }

  // 拉列表
  const list = await db
    .select({
      id: mediaAssets.id,
      type: mediaAssets.type,
      purpose: mediaAssets.purpose,
      visibility: mediaAssets.visibility,
      unlockPricePoints: mediaAssets.unlockPricePoints,
      r2Key: mediaAssets.r2Key,
      publicUrl: mediaAssets.publicUrl,
      thumbnailUrl: mediaAssets.thumbnailUrl,
      mimeType: mediaAssets.mimeType,
      sizeBytes: mediaAssets.sizeBytes,
      durationMs: mediaAssets.durationMs,
      widthPx: mediaAssets.widthPx,
      heightPx: mediaAssets.heightPx,
      auditStatus: mediaAssets.auditStatus,
      auditedAt: mediaAssets.auditedAt,
      isEncrypted: mediaAssets.isEncrypted,
      watermarkApplied: mediaAssets.watermarkApplied,
      deletedAt: mediaAssets.deletedAt,
      createdAt: mediaAssets.createdAt,
    })
    .from(mediaAssets)
    .where(and(...conds))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(q.limit ?? 200)
    .offset(q.offset ?? 0);

  // ops 看不到 url(只看 metadata)
  const cleaned = list.map((m) => ({
    ...m,
    publicUrl: showContent ? m.publicUrl : null,
    thumbnailUrl: showContent ? m.thumbnailUrl : null,
    r2Key: showLiveness ? m.r2Key : null, // 只 admin/auditor 能看 raw key
  }));

  // 按 visibility 分组统计(给前端 tab 标徽用)
  const totals = await db
    .select({
      total: sql<number>`count(*)::int`,
      public_n: sql<number>`count(*) FILTER (WHERE visibility='public')::int`,
      paid_n: sql<number>`count(*) FILTER (WHERE visibility='paid_unlock')::int`,
      platform_n: sql<number>`count(*) FILTER (WHERE visibility='platform_only')::int`,
      pending_n: sql<number>`count(*) FILTER (WHERE audit_status='pending')::int`,
      approved_n: sql<number>`count(*) FILTER (WHERE audit_status='approved')::int`,
      rejected_n: sql<number>`count(*) FILTER (WHERE audit_status='rejected')::int`,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.ownerUserId, id), isNull(mediaAssets.deletedAt)));

  return c.json({
    data: {
      list: cleaned,
      totals: totals[0] ?? {},
      meta: {
        content_masked: !showContent,
        liveness_visible: showLiveness,
      },
    },
  });
});
