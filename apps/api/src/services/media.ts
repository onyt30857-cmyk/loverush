/**
 * 媒体服务 · M02
 *
 * R2 上传两步走：
 * 1. 客户端调 issueUploadUrl 拿到 pre-signed PUT URL + media_id
 * 2. 客户端 PUT 文件到 R2，完成后调 finalizeMedia 通知后端 → 进入审核队列
 *
 * R2 SDK 暂未接入（@aws-sdk/client-s3 兼容 R2），先返回 stub URL；
 * Phase 2.4 / Phase 3 接入真实 R2 时把 stub 换成 getSignedUrl 调用即可。
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  Database,
  mediaAssets,
  contentAuditRecords,
  type MediaAsset,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface MediaContext {
  db: Database;
  r2BucketName?: string;
  r2PublicBase?: string;
}

export type MediaPurpose =
  | 'avatar'
  | 'voice_intro'
  | 'short_video'
  | 'gallery'
  | 'liveness'
  | 'chat_attachment';

const MAX_SIZE_BYTES: Record<MediaPurpose, number> = {
  avatar: 5 * 1024 * 1024,
  voice_intro: 10 * 1024 * 1024,
  short_video: 50 * 1024 * 1024,
  gallery: 20 * 1024 * 1024,
  liveness: 100 * 1024 * 1024,
  chat_attachment: 30 * 1024 * 1024,
};

function r2KeyFor(ownerUserId: string, purpose: MediaPurpose, ext: string): string {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  return `${purpose}/${yyyymm}/${ownerUserId}/${nanoid(20)}.${ext}`;
}

// 把业务 purpose + mimeType 映射到 DB media_type enum（sticker/gif/photo/video/audio）
// purpose 是上层用途标签（avatar/voice_intro/short_video/...）· type 只标 mime 大类
function inferMediaType(mimeType: string, purpose: MediaPurpose): 'sticker' | 'gif' | 'photo' | 'video' | 'audio' {
  const m = mimeType.toLowerCase();
  if (m === 'image/gif') return 'gif';
  if (m.startsWith('image/')) {
    return purpose === 'chat_attachment' ? 'sticker' : 'photo';
  }
  if (m.startsWith('audio/') || purpose === 'voice_intro') return 'audio';
  if (m.startsWith('video/') || purpose === 'short_video' || purpose === 'liveness') return 'video';
  return 'photo'; // 兜底
}

/** 颁发上传 URL（pre-signed PUT，5 分钟过期） */
export async function issueUploadUrl(
  ctx: MediaContext,
  args: {
    ownerUserId: string;
    purpose: MediaPurpose;
    mimeType: string;
    sizeBytes: number;
    ext: string;
  },
): Promise<{ mediaId: string; uploadUrl: string; r2Key: string; expiresInSeconds: number }> {
  const limit = MAX_SIZE_BYTES[args.purpose];
  if (args.sizeBytes > limit) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, `file too large, max ${limit} bytes`);
  }

  const r2Key = r2KeyFor(args.ownerUserId, args.purpose, args.ext);
  const isEncrypted = args.purpose === 'liveness' ? 1 : 0;

  const [row] = await ctx.db
    .insert(mediaAssets)
    .values({
      ownerUserId: args.ownerUserId,
      type: inferMediaType(args.mimeType, args.purpose),
      r2Key,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      purpose: args.purpose,
      visibility: args.purpose === 'liveness' ? 'platform_only' : 'public',
      auditStatus: 'pending',
      isEncrypted,
    })
    .returning();

  if (!row) throw HttpError.internal('media row create failed');

  // 优先走真 R2 签名 URL · 无 R2 凭证降级 stub
  const r2 = await import('./r2');
  let uploadUrl: string;
  let publicUrl: string;
  let expiresInSeconds = 300;

  if (r2.isR2Available()) {
    const signed = await r2.createSignedUploadUrl({
      key: r2Key,
      contentType: args.mimeType,
      contentLengthMax: args.sizeBytes,
      expiresInSeconds: 300,
    });
    uploadUrl = signed.uploadUrl;
    publicUrl = signed.publicUrl;
    expiresInSeconds = signed.expiresInSeconds;
  } else {
    uploadUrl = `${ctx.r2PublicBase ?? 'https://r2-stub.local'}/upload/${r2Key}?stub=1`;
    publicUrl = `${ctx.r2PublicBase ?? 'https://media.loverush.com'}/${r2Key}`;
  }

  // 把 publicUrl 写到 media_assets 行（finalize 时不再重算）
  await ctx.db
    .update(mediaAssets)
    .set({ publicUrl })
    .where(eq(mediaAssets.id, row.id));

  return {
    mediaId: row.id,
    uploadUrl,
    r2Key,
    expiresInSeconds,
  };
}

/** 客户端上传完成后调用，落库 metadata + 创建审核工单 */
export async function finalizeMedia(
  ctx: MediaContext,
  args: {
    mediaId: string;
    ownerUserId: string;
    actualSizeBytes?: number;
    durationMs?: number;
    widthPx?: number;
    heightPx?: number;
    thumbnailUrl?: string;
    visibility?: 'public' | 'paid_unlock' | 'platform_only';
    unlockPricePoints?: number;
  },
): Promise<MediaAsset> {
  const row = await ctx.db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, args.mediaId) });
  if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'media not found');
  if (row.ownerUserId !== args.ownerUserId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your media');
  }

  // publicUrl 在 issueUploadUrl 时已写入 · 这里复用
  const publicUrl = row.publicUrl ?? `${ctx.r2PublicBase ?? 'https://media.loverush.com'}/${row.r2Key}`;

  const [updated] = await ctx.db
    .update(mediaAssets)
    .set({
      publicUrl,
      sizeBytes: args.actualSizeBytes ?? row.sizeBytes,
      durationMs: args.durationMs,
      widthPx: args.widthPx,
      heightPx: args.heightPx,
      thumbnailUrl: args.thumbnailUrl,
      visibility: args.visibility ?? row.visibility,
      unlockPricePoints: args.unlockPricePoints,
      updatedAt: new Date(),
    })
    .where(eq(mediaAssets.id, args.mediaId))
    .returning();

  if (!updated) throw HttpError.internal('media finalize failed');

  // 创建审核工单
  await ctx.db.insert(contentAuditRecords).values({
    targetType: 'media',
    targetId: updated.id,
    targetUserId: args.ownerUserId,
    snapshot: {
      mediaId: updated.id,
      purpose: updated.purpose,
      mimeType: updated.mimeType,
      publicUrl: updated.publicUrl,
      thumbnailUrl: updated.thumbnailUrl,
    },
    status: 'pending',
    priority: updated.purpose === 'liveness' ? 100 : 0,
    slaDeadlineAt: new Date(Date.now() + 24 * 3600 * 1000), // 24h SLA
  });

  return updated;
}
